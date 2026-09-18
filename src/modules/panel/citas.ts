/**
 * Alta de una cita desde el panel.
 *
 * En Fase 1 el contacto con el proveedor es humano (sección 10): la operadora
 * habla con el negocio, aparta y captura aquí lo que acordó. A partir de ese
 * momento los avisos a la clienta ya son automáticos.
 *
 * Al crearla se materializan los cuatro avisos: la confirmación sale de
 * inmediato y T−7, T−3 y T−0 se calculan sobre la HORA LOCAL DE PARED, no
 * restándole horas al instante de la cita (RNF-02).
 */
import type pg from 'pg';
import { enTransaccion } from '../../db/pool.js';
import {
  type MomentoConOffset,
  type MomentoRecordatorio,
  programaDeRecordatorios,
} from '../../domain/agenda.js';
import { type FechaLocal, instanteDesdeLocal } from '../../domain/tiempo.js';

/** Los tres avisos que dependen de la fecha de la cita. */
const MOMENTOS_DE_LA_CITA: readonly MomentoConOffset[] = ['t_7', 't_3', 't_0'];

export interface DatosNuevaCita {
  rutinaId: string;
  fecha: FechaLocal;
  hora: string;
  /** Lo que el negocio dijo que cuesta. Sin valor, la cita queda «por confirmar». */
  costoInformado?: number | null;
  indicaciones?: string | null;
}

export interface ResultadoNuevaCita {
  citaId: string;
  iniciaEn: Date;
  /** Los avisos que quedaron programados. */
  programados: MomentoRecordatorio[];
  /**
   * Los que NO se programaron porque su momento ya pasó.
   *
   * Se devuelven para que el panel lo diga en pantalla: una cita capturada con
   * cinco días de anticipación no puede tener aviso de T−7, y la operadora
   * tiene que saberlo en ese instante, no descubrirlo cuando la clienta se
   * queje de que nunca le avisaron.
   */
  omitidosPorVencidos: MomentoRecordatorio[];
}

export class RutinaNoEncontrada extends Error {
  constructor(id: string) {
    super(`No se encontró la rutina ${id}.`);
    this.name = 'RutinaNoEncontrada';
  }
}

interface FilaRutina {
  usuaria_id: string;
  mascota_id: string;
  proveedor_id: string;
  tipo_servicio: string;
  costo_referencia: number | null;
  proxima_fecha_estimada: FechaLocal;
  zona_horaria: string;
  hora_aviso_dia: string;
  desactivados: MomentoConOffset[] | null;
}

export async function crearCitaDesdePanel(
  pool: pg.Pool,
  datos: DatosNuevaCita,
  opciones: { ahora?: Date } = {},
): Promise<ResultadoNuevaCita> {
  const ahora = opciones.ahora ?? new Date();

  const { rows } = await pool.query<FilaRutina>(
    `SELECT r.usuaria_id, r.mascota_id, r.proveedor_id, r.tipo_servicio,
            r.costo_referencia, r.proxima_fecha_estimada,
            u.zona_horaria, u.hora_aviso_dia,
            (SELECT array_agg(rd.momento::text) FROM recordatorio_desactivado rd
              WHERE rd.usuaria_id = u.id) AS desactivados
       FROM rutina r
       JOIN usuaria u ON u.id = r.usuaria_id
      WHERE r.id = $1 AND u.anonimizada_en IS NULL`,
    [datos.rutinaId],
  );

  const rutina = rows[0];
  if (!rutina) throw new RutinaNoEncontrada(datos.rutinaId);

  const iniciaEn = instanteDesdeLocal(datos.fecha, datos.hora, rutina.zona_horaria);
  const yaPaso = iniciaEn.getTime() <= ahora.getTime();

  // El costo informado manda; si no vino, se usa el de referencia de la rutina
  // como estimación, y si tampoco hay, la cita nace «por confirmar».
  const costo = datos.costoInformado ?? rutina.costo_referencia ?? null;

  return enTransaccion(pool, async (cliente) => {
    const { rows: creadas } = await cliente.query<{ id: string }>(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, rutina_id, tipo_servicio,
                         estado, inicia_en, costo_confirmado, indicaciones)
       VALUES ($1,$2,$3,$4,$5,'confirmada',$6,$7,$8)
       RETURNING id`,
      [
        rutina.usuaria_id,
        rutina.mascota_id,
        rutina.proveedor_id,
        datos.rutinaId,
        rutina.tipo_servicio,
        iniciaEn,
        costo,
        datos.indicaciones?.trim() || null,
      ],
    );
    const citaId = creadas[0]!.id;

    const programados: MomentoRecordatorio[] = [];
    const omitidos: MomentoRecordatorio[] = [];

    // La confirmación sale ya. Para una cita que ya pasó no tiene sentido:
    // confirmarle a la clienta algo que ocurrió ayer solo confunde.
    if (yaPaso) {
      omitidos.push('confirmacion');
    } else {
      await cliente.query(
        `INSERT INTO recordatorio (cita_id, usuaria_id, momento, programado_para)
         VALUES ($1,$2,'confirmacion',$3)
         ON CONFLICT (cita_id, momento) DO NOTHING`,
        [citaId, rutina.usuaria_id, ahora],
      );
      programados.push('confirmacion');
    }

    // `programaDeRecordatorios` ya descarta los momentos cuyo instante quedó
    // atrás: no hay que volver a filtrar aquí, ni programar nada en el pasado.
    const programa = programaDeRecordatorios({
      iniciaEn,
      zona: rutina.zona_horaria,
      horaAvisoDia: rutina.hora_aviso_dia,
      desactivados: rutina.desactivados ?? [],
      ahora,
      momentos: MOMENTOS_DE_LA_CITA,
    });

    const apagados = new Set(rutina.desactivados ?? []);

    for (const { momento, programadoPara } of programa) {
      await cliente.query(
        `INSERT INTO recordatorio (cita_id, usuaria_id, momento, programado_para)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (cita_id, momento) DO NOTHING`,
        [citaId, rutina.usuaria_id, momento, programadoPara],
      );
      programados.push(momento);
    }

    // Lo que no entró y tampoco lo apagó la usuaria, quedó fuera por vencido.
    for (const momento of MOMENTOS_DE_LA_CITA) {
      if (!programados.includes(momento) && !apagados.has(momento)) omitidos.push(momento);
    }

    // La rutina ya tiene cita para este ciclo: el barrido de T−21 no debe
    // volver a preguntarle a la clienta por una fecha que ya está apartada.
    await cliente.query(
      `UPDATE rutina SET cita_generada_para = proxima_fecha_estimada, actualizada_en = now()
        WHERE id = $1`,
      [datos.rutinaId],
    );

    return { citaId, iniciaEn, programados, omitidosPorVencidos: omitidos };
  });
}

// ---------------------------------------------------------------------------
// Rutinas, para poder elegir una al crear la cita
// ---------------------------------------------------------------------------

export interface RutinaParaElegir {
  id: string;
  etiqueta: string;
  mascota: string;
  clienta: string | null;
  servicio: string;
  proveedor: string;
  costoReferencia: number | null;
  proximaFechaEstimada: FechaLocal;
}

export async function rutinasParaElegir(pool: pg.Pool): Promise<RutinaParaElegir[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.costo_referencia, r.proxima_fecha_estimada,
            m.nombre AS mascota, u.nombre AS clienta, ts.nombre AS servicio,
            CASE WHEN p.sucursal IS NULL OR p.sucursal = '' THEN p.negocio
                 ELSE p.negocio || ' ' || p.sucursal END AS proveedor
       FROM rutina r
       JOIN mascota m        ON m.id = r.mascota_id
       JOIN usuaria u        ON u.id = r.usuaria_id
       JOIN proveedor p      ON p.id = r.proveedor_id
       JOIN tipo_servicio ts ON ts.codigo = r.tipo_servicio
      WHERE r.activa AND u.anonimizada_en IS NULL AND u.estado <> 'no_acepto'
      ORDER BY r.proxima_fecha_estimada`,
  );

  return rows.map((r) => ({
    id: r.id,
    // Lo que se lee en el desplegable: mascota, servicio y de quién es.
    etiqueta: `${r.mascota} · ${r.servicio} · ${r.clienta ?? 'sin nombre'}`,
    mascota: r.mascota,
    clienta: r.clienta,
    servicio: r.servicio,
    proveedor: r.proveedor,
    costoReferencia: r.costo_referencia,
    proximaFechaEstimada: r.proxima_fecha_estimada,
  }));
}
