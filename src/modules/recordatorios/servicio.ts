/**
 * Programacion y envio de los avisos (RF-12, RF-15, RNF-03, RNF-04).
 *
 * El diseno parte de una idea: LA TABLA `recordatorio` ES LA FUENTE DE VERDAD,
 * no la cola de trabajos.
 *
 * La tentacion es encolar un trabajo por aviso a 21 dias vista y confiar en que
 * la cola lo dispare. Pero el documento dice que el programador de tareas "es
 * el componente del que depende toda la promesa del producto" (seccion 08), y
 * una cola que pierde un trabajo -- por una migracion, un despliegue, un purgado
 * mal hecho -- lo pierde en silencio: nadie se entera hasta que una usuaria
 * llega sin saber que tenia cita.
 *
 * Aqui la cola solo dispara un BARRIDO cada minuto. El barrido pregunta a la
 * base que avisos ya vencieron y los manda. Si el barrido no corre durante una
 * hora, al volver encuentra todo lo atrasado y lo saca; si se ejecuta dos veces
 * a la vez, el bloqueo de filas evita el envio duplicado. Un minuto de periodo
 * dentro de una tolerancia de quince (RNF-03) deja margen de sobra.
 */
import type pg from 'pg';
import type { Ejecutor } from '../../db/pool.js';
import { enTransaccion } from '../../db/pool.js';
import {
  type MomentoConOffset,
  type MomentoRecordatorio,
  programaDeRecordatorios,
  recalcularPendientes,
  siguienteFechaEstimada,
} from '../../domain/agenda.js';
import { fechaLocalDe } from '../../domain/tiempo.js';
import { aceptaRecordatorios, type EstadoCita } from '../../domain/citas.js';
import { type DatosAviso, type OpcionHorario, mesDe, redactarAviso } from '../mensajes/contenido.js';
import type { CanalWhatsApp } from '../../channels/whatsapp/index.js';
import { ErrorEnvio } from '../../channels/whatsapp/index.js';
import { type PreferenciaAgenda, opcionesDeHorario } from '../agendamiento/preferencias.js';

/** RNF-03: tolerancia maxima entre la hora programada y el envio real. */
export const TOLERANCIA_MINUTOS = 15;

/**
 * RNF-04: reintento automatico de envios fallidos.
 *
 * Los tres reintentos caben dentro de la tolerancia de 15 minutos (1 + 2 + 4 =
 * 7 minutos de espera acumulada). Reintentar mas alla de eso no sirve: el aviso
 * ya incumplio y lo que toca es que una persona lo vea.
 */
export const BACKOFF_SEGUNDOS = [60, 120, 240] as const;
export const MAX_INTENTOS = BACKOFF_SEGUNDOS.length + 1;

export interface Reloj {
  ahora(): Date;
}

export const RELOJ_DEL_SISTEMA: Reloj = { ahora: () => new Date() };

export interface DependenciasEnvio {
  pool: pg.Pool;
  whatsapp: CanalWhatsApp;
  reloj?: Reloj;
}

// ---------------------------------------------------------------------------
// Programacion
// ---------------------------------------------------------------------------

interface FilaCitaParaProgramar {
  id: string;
  usuaria_id: string;
  estado: EstadoCita;
  inicia_en: Date;
  zona_horaria: string;
  hora_aviso_dia: string;
  desactivados: MomentoConOffset[] | null;
}

const SQL_CITA_PARA_PROGRAMAR = `
  SELECT c.id, c.usuaria_id, c.estado, c.inicia_en,
         u.zona_horaria, u.hora_aviso_dia,
         -- El cast a text no es cosmetico: sin el, node-pg no sabe parsear un
         -- arreglo de enum propio y devuelve la cadena cruda "{t_3,t_7}".
         (SELECT array_agg(rd.momento::text) FROM recordatorio_desactivado rd
           WHERE rd.usuaria_id = u.id) AS desactivados
    FROM cita c
    JOIN usuaria u ON u.id = c.usuaria_id
   WHERE c.id = $1
`;

/**
 * Crea las filas de recordatorio que corresponden a una cita.
 *
 * Es idempotente: el indice unico (cita_id, momento) hace que volver a llamarla
 * no duplique avisos, lo que importa porque se invoca tanto al confirmar la
 * cita como al reagendarla.
 */
export async function programarRecordatoriosDeCita(
  ejecutor: Ejecutor,
  citaId: string,
  opciones: { ahora?: Date; momentos?: readonly MomentoConOffset[] } = {},
): Promise<number> {
  const { rows } = await ejecutor.query<FilaCitaParaProgramar>(SQL_CITA_PARA_PROGRAMAR, [citaId]);
  const cita = rows[0];
  if (!cita) throw new Error(`No existe la cita ${citaId}`);
  if (!aceptaRecordatorios(cita.estado)) return 0;

  const programa = programaDeRecordatorios({
    iniciaEn: cita.inicia_en,
    zona: cita.zona_horaria,
    horaAvisoDia: cita.hora_aviso_dia,
    desactivados: cita.desactivados ?? [],
    ahora: opciones.ahora ?? new Date(),
    ...(opciones.momentos ? { momentos: opciones.momentos } : {}),
  });

  let insertados = 0;
  for (const { momento, programadoPara } of programa) {
    const resultado = await ejecutor.query(
      `INSERT INTO recordatorio (cita_id, usuaria_id, momento, programado_para)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cita_id, momento) DO NOTHING`,
      [citaId, cita.usuaria_id, momento, programadoPara],
    );
    insertados += resultado.rowCount ?? 0;
  }
  return insertados;
}

/**
 * Recalcula los avisos pendientes tras reagendar (criterio de la seccion 12).
 *
 * Los ya enviados se quedan como estan: son historia y la bitacora debe seguir
 * mostrando lo que la usuaria leyo. Los pendientes se borran y se vuelven a
 * calcular contra la fecha nueva.
 */
export async function reprogramarRecordatorios(
  ejecutor: Ejecutor,
  citaId: string,
  opciones: { ahora?: Date } = {},
): Promise<number> {
  const ahora = opciones.ahora ?? new Date();

  const { rows: enviadas } = await ejecutor.query<{ momento: MomentoConOffset }>(
    `SELECT momento FROM recordatorio
      WHERE cita_id = $1 AND estado IN ('enviado','entregado','leido')`,
    [citaId],
  );

  await ejecutor.query(
    `DELETE FROM recordatorio
      WHERE cita_id = $1 AND estado IN ('programado','fallido','cancelado')`,
    [citaId],
  );

  const { rows } = await ejecutor.query<FilaCitaParaProgramar>(SQL_CITA_PARA_PROGRAMAR, [citaId]);
  const cita = rows[0];
  if (!cita) throw new Error(`No existe la cita ${citaId}`);
  if (!aceptaRecordatorios(cita.estado)) return 0;

  const pendientes = recalcularPendientes(
    enviadas.map((f) => f.momento),
    {
      iniciaEn: cita.inicia_en,
      zona: cita.zona_horaria,
      horaAvisoDia: cita.hora_aviso_dia,
      desactivados: cita.desactivados ?? [],
      ahora,
    },
  );

  for (const { momento, programadoPara } of pendientes) {
    await ejecutor.query(
      `INSERT INTO recordatorio (cita_id, usuaria_id, momento, programado_para)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cita_id, momento) DO UPDATE SET programado_para = EXCLUDED.programado_para`,
      [citaId, cita.usuaria_id, momento, programadoPara],
    );
  }
  return pendientes.length;
}

/** Al cancelar una cita se apagan sus avisos pendientes. */
export async function cancelarRecordatoriosPendientes(ejecutor: Ejecutor, citaId: string): Promise<number> {
  const resultado = await ejecutor.query(
    `UPDATE recordatorio SET estado = 'cancelado'
      WHERE cita_id = $1 AND estado IN ('programado','fallido')`,
    [citaId],
  );
  return resultado.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Barrido y envio
// ---------------------------------------------------------------------------

export interface FilaRecordatorioVencido {
  id: string;
  cita_id: string;
  usuaria_id: string;
  momento: MomentoRecordatorio;
  programado_para: Date;
  intentos: number;
  celular: string;
  correo: string | null;
  canal_preferido: 'whatsapp' | 'correo' | 'ambos';
  zona_horaria: string;
  estado_cita: EstadoCita;
  inicia_en: Date;
  servicio: string;
  articulo_servicio: 'el' | 'la' | null;
  mascota: string;
  proveedor: string;
  direccion: string | null;
  costo_confirmado: number | null;
  indicaciones: string | null;
  proveedor_id: string;
  preferencias: PreferenciaAgenda[] | null;
  usuaria: string | null;
  rutina_id: string | null;
  frecuencia_cantidad: number | null;
  frecuencia_unidad: 'semanas' | 'meses' | null;
}

/**
 * Consulta base de un aviso con todo lo que hace falta para redactarlo.
 *
 * La comparte el barrido (que los envia) y el panel interno (que los muestra en
 * la pestaña de Hoy). Tenerla en un solo lugar es lo que evita que el texto que
 * la operadora ve en pantalla y el que sale por WhatsApp se separen.
 */
export const SQL_AVISO_COMPLETO = `
  SELECT r.id, r.cita_id, r.usuaria_id, r.momento, r.programado_para, r.intentos,
         r.estado, r.enviado_en,
         u.celular, u.correo, u.canal_preferido, u.zona_horaria, u.nombre AS usuaria,
         c.estado AS estado_cita, c.inicia_en, c.costo_confirmado, c.indicaciones,
         ts.nombre AS servicio,
         ts.articulo AS articulo_servicio,
         m.nombre  AS mascota,
         p.id      AS proveedor_id,
         CASE WHEN p.sucursal IS NULL OR p.sucursal = '' THEN p.negocio
              ELSE p.negocio || ' ' || p.sucursal END AS proveedor,
         p.direccion,
         (SELECT json_agg(json_build_object(
                   'diaSemana', pa.dia_semana,
                   'horaInicio', pa.hora_inicio,
                   'horaFin', pa.hora_fin,
                   'prioridad', pa.prioridad)
                 ORDER BY pa.prioridad)
            FROM preferencia_agenda pa
           WHERE pa.usuaria_id = u.id) AS preferencias
    FROM recordatorio r
    JOIN cita c           ON c.id = r.cita_id
    JOIN usuaria u        ON u.id = r.usuaria_id
    JOIN mascota m        ON m.id = c.mascota_id
    JOIN proveedor p      ON p.id = c.proveedor_id
    JOIN tipo_servicio ts ON ts.codigo = c.tipo_servicio
`;

/**
 * Toma los avisos vencidos y los marca como "enviando" en la misma transaccion.
 *
 * SKIP LOCKED permite correr varios trabajadores sin que dos agarren el mismo
 * aviso, y sin que uno lento bloquee a los demas.
 */
async function reclamarVencidos(pool: pg.Pool, ahora: Date, limite: number): Promise<FilaRecordatorioVencido[]> {
  return enTransaccion(pool, async (cliente) => {
    const { rows } = await cliente.query<FilaRecordatorioVencido>(
      `SELECT r.id, r.cita_id, r.usuaria_id, r.momento, r.programado_para, r.intentos,
              u.celular, u.correo, u.canal_preferido, u.zona_horaria, u.nombre AS usuaria,
              c.rutina_id, ru.frecuencia_cantidad, ru.frecuencia_unidad,
              c.estado AS estado_cita, c.inicia_en, c.costo_confirmado, c.indicaciones,
              ts.nombre AS servicio,
              ts.articulo AS articulo_servicio,
              m.nombre  AS mascota,
              p.id      AS proveedor_id,
              CASE WHEN p.sucursal IS NULL OR p.sucursal = '' THEN p.negocio
                   ELSE p.negocio || ' ' || p.sucursal END AS proveedor,
              p.direccion,
              (SELECT json_agg(json_build_object(
                        'diaSemana', pa.dia_semana,
                        'horaInicio', pa.hora_inicio,
                        'horaFin', pa.hora_fin,
                        'prioridad', pa.prioridad)
                      ORDER BY pa.prioridad)
                 FROM preferencia_agenda pa
                WHERE pa.usuaria_id = u.id) AS preferencias
         FROM recordatorio r
         JOIN cita c          ON c.id = r.cita_id
         JOIN usuaria u       ON u.id = r.usuaria_id
         JOIN mascota m       ON m.id = c.mascota_id
         JOIN proveedor p     ON p.id = c.proveedor_id
         JOIN tipo_servicio ts ON ts.codigo = c.tipo_servicio
         LEFT JOIN rutina ru   ON ru.id = c.rutina_id
        WHERE r.estado IN ('programado','fallido')
          AND COALESCE(r.proximo_intento_en, r.programado_para) <= $1
          AND u.anonimizada_en IS NULL
        ORDER BY r.programado_para
        LIMIT $2
          FOR UPDATE OF r SKIP LOCKED`,
      [ahora, limite],
    );

    if (rows.length > 0) {
      await cliente.query(`UPDATE recordatorio SET estado = 'enviando' WHERE id = ANY($1::uuid[])`, [
        rows.map((r) => r.id),
      ]);
    }
    return rows;
  });
}

export interface ResultadoBarrido {
  enviados: number;
  fallidos: number;
  cancelados: number;
  fueraDeTolerancia: number;
}

/**
 * Manda todos los avisos vencidos.
 *
 * Se llama cada minuto desde la cola. Devuelve un resumen para que el panel
 * interno y las pruebas puedan verificarlo.
 */
export async function barrerRecordatorios(
  deps: DependenciasEnvio,
  opciones: { limite?: number } = {},
): Promise<ResultadoBarrido> {
  const reloj = deps.reloj ?? RELOJ_DEL_SISTEMA;
  const ahora = reloj.ahora();
  const pendientes = await reclamarVencidos(deps.pool, ahora, opciones.limite ?? 200);

  const resumen: ResultadoBarrido = { enviados: 0, fallidos: 0, cancelados: 0, fueraDeTolerancia: 0 };

  for (const fila of pendientes) {
    // La cita pudo cancelarse o reagendarse entre la programacion y el envio.
    if (!aceptaRecordatorios(fila.estado_cita)) {
      await deps.pool.query(`UPDATE recordatorio SET estado = 'cancelado' WHERE id = $1`, [fila.id]);
      resumen.cancelados += 1;
      continue;
    }

    // Un recordatorio previo a una cita que ya paso no tiene a quien servir.
    // El cierre (T+1) si va despues de la cita, por eso queda excluido.
    if (fila.momento !== 'cierre' && fila.inicia_en.getTime() <= ahora.getTime()) {
      await deps.pool.query(
        `UPDATE recordatorio SET estado = 'cancelado', ultimo_error = $2 WHERE id = $1`,
        [fila.id, 'La cita ya habia ocurrido cuando toco enviar el aviso'],
      );
      await abrirCaso(deps.pool, {
        citaId: fila.cita_id,
        usuariaId: fila.usuaria_id,
        motivo: 'envio_fallido',
        detalle: `El aviso ${fila.momento} vencio despues de la cita y no se envio.`,
      });
      resumen.cancelados += 1;
      continue;
    }

    const retrasoSegundos = Math.max(0, Math.round((ahora.getTime() - fila.programado_para.getTime()) / 1000));
    const datos = datosDeAviso(fila);

    try {
      const aviso = redactarAviso(fila.momento, datos, opcionesParaAviso(fila));
      const { idExterno } = await deps.whatsapp.enviarPlantilla({
        a: fila.celular,
        plantilla: aviso.plantilla,
        variables: aviso.variables,
      });

      await deps.pool.query(
        `UPDATE recordatorio
            SET estado = 'enviado', enviado_en = $2, contenido_enviado = $3,
                plantilla = $4, id_externo = $5, intentos = intentos + 1,
                retraso_segundos = $6, ultimo_error = NULL, proximo_intento_en = NULL
          WHERE id = $1`,
        [fila.id, ahora, aviso.texto, aviso.plantilla, idExterno, retrasoSegundos],
      );
      resumen.enviados += 1;

      // RNF-03: el aviso salio, pero tarde. No se oculta.
      if (retrasoSegundos > TOLERANCIA_MINUTOS * 60) {
        resumen.fueraDeTolerancia += 1;
        await abrirCaso(deps.pool, {
          citaId: fila.cita_id,
          usuariaId: fila.usuaria_id,
          motivo: 'envio_fuera_de_tolerancia',
          detalle:
            `El aviso ${fila.momento} salio con ${Math.round(retrasoSegundos / 60)} minutos de retraso ` +
            `(tolerancia: ${TOLERANCIA_MINUTOS}).`,
        });
      }
    } catch (error) {
      await registrarFalla(deps.pool, fila, error, ahora);
      resumen.fallidos += 1;
    }
  }

  return resumen;
}

export function datosDeAviso(fila: FilaRecordatorioVencido): DatosAviso {
  return {
    servicio: fila.servicio,
    articuloServicio: fila.articulo_servicio,
    mascota: fila.mascota,
    nombrePila: fila.usuaria,
    iniciaEn: fila.inicia_en,
    zona: fila.zona_horaria,
    proveedor: fila.proveedor,
    direccion: fila.direccion,
    costo: fila.costo_confirmado,
    indicaciones: fila.momento === 't_0' ? fila.indicaciones : null,
    mesSiguiente: mesDelSiguienteCiclo(fila),
  };
}

/**
 * Mes en el que toca el siguiente servicio, para el cierre.
 *
 * Se cuenta desde el dia en que la cita realmente ocurrio, igual que
 * `cerrarCita`, para que el mes que se le promete a la usuaria sea el mismo que
 * el sistema va a programar. Una cita puntual no tiene siguiente y devuelve
 * null, que es lo que elige la variante del cierre sin promesa.
 */
function mesDelSiguienteCiclo(fila: FilaRecordatorioVencido): string | null {
  if (!fila.rutina_id || !fila.frecuencia_cantidad || !fila.frecuencia_unidad) return null;
  const fechaCita = fechaLocalDe(fila.inicia_en, fila.zona_horaria);
  return mesDe(siguienteFechaEstimada(fechaCita, fila.frecuencia_cantidad, fila.frecuencia_unidad));
}

/**
 * Opciones de horario para el aviso de T-21 (RF-03).
 *
 * Se derivan de las preferencias guardadas de la usuaria; sin preferencias,
 * `opcionesDeHorario` ofrece dias habiles cercanos. Los demas momentos no
 * llevan opciones.
 */
export function opcionesParaAviso(fila: FilaRecordatorioVencido): OpcionHorario[] {
  if (fila.momento !== 't_21') return [];
  return opcionesDeHorario(fila.preferencias ?? [], fila.inicia_en, fila.zona_horaria);
}

async function registrarFalla(
  pool: pg.Pool,
  fila: FilaRecordatorioVencido,
  error: unknown,
  ahora: Date,
): Promise<void> {
  const intentos = fila.intentos + 1;
  const reintentable = error instanceof ErrorEnvio ? error.reintentable : true;
  const mensaje = error instanceof Error ? error.message : String(error);
  const quedanIntentos = reintentable && intentos < MAX_INTENTOS;

  const proximoIntento = quedanIntentos
    ? new Date(ahora.getTime() + (BACKOFF_SEGUNDOS[intentos - 1] ?? 240) * 1000)
    : null;

  await pool.query(
    `UPDATE recordatorio
        SET estado = 'fallido', intentos = $2, ultimo_error = $3, proximo_intento_en = $4
      WHERE id = $1`,
    [fila.id, intentos, mensaje.slice(0, 500), proximoIntento],
  );

  // RNF-04: "alerta al panel interno si un aviso no salio".
  if (!quedanIntentos) {
    await abrirCaso(pool, {
      citaId: fila.cita_id,
      usuariaId: fila.usuaria_id,
      motivo: 'envio_fallido',
      detalle: `El aviso ${fila.momento} fallo ${intentos} veces. Ultimo error: ${mensaje.slice(0, 300)}`,
    });
  }
}

export async function abrirCaso(
  ejecutor: Ejecutor,
  caso: { citaId?: string | null; usuariaId?: string | null; motivo: string; detalle: string },
): Promise<void> {
  await ejecutor.query(
    `INSERT INTO caso_excepcion (cita_id, usuaria_id, motivo, detalle) VALUES ($1, $2, $3, $4)`,
    [caso.citaId ?? null, caso.usuariaId ?? null, caso.motivo, caso.detalle],
  );
}

// ---------------------------------------------------------------------------
// Webhooks de entrega y lectura (RF-15)
// ---------------------------------------------------------------------------

/**
 * RF-15: "Registro de entrega y lectura de cada aviso, para detectar fallas de
 * envio."
 *
 * Los estados solo avanzan: si un webhook de "entregado" llega despues del de
 * "leido" -- cosa que pasa, porque no vienen ordenados -- no debe retroceder.
 */
export async function registrarEstadoDeEntrega(
  ejecutor: Ejecutor,
  idExterno: string,
  estado: 'entregado' | 'leido' | 'fallido',
  cuando: Date,
): Promise<boolean> {
  const columna = estado === 'entregado' ? 'entregado_en' : estado === 'leido' ? 'leido_en' : null;
  const orden = { enviado: 1, entregado: 2, leido: 3 } as const;

  const resultado = await ejecutor.query(
    `UPDATE recordatorio
        SET estado = $2::estado_entrega,
            ${columna ? `${columna} = COALESCE(${columna}, $3),` : ''}
            ultimo_error = CASE WHEN $2 = 'fallido' THEN 'Reporte de fallo del proveedor' ELSE ultimo_error END
      WHERE id_externo = $1
        AND COALESCE(($4::jsonb ->> estado::text)::int, 0) < $5`,
    [idExterno, estado, cuando, JSON.stringify(orden), estado === 'fallido' ? 99 : orden[estado]],
  );
  return (resultado.rowCount ?? 0) > 0;
}
