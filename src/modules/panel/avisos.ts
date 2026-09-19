/**
 * Avisos del día para el panel interno — pestaña «Hoy».
 *
 * En la Fase 1 el contacto con el proveedor es humano (sección 10), y buena
 * parte del trabajo de la operadora es ver qué avisos tocan y mandarlos. Esta
 * consulta le da lo que necesita para hacerlo sin pensar: el texto exacto ya
 * redactado y un enlace que abre WhatsApp con ese texto puesto.
 *
 * El texto se redacta con los MISMOS composers que usa el barrido automático
 * (`redactarAviso`), no con una copia. Si se separaran, la operadora estaría
 * leyendo en pantalla algo distinto de lo que sale por el canal.
 */
import type pg from 'pg';
import {
  type FilaRecordatorioVencido,
  SQL_AVISO_COMPLETO,
  datosDeAviso,
  opcionesParaAviso,
} from '../recordatorios/servicio.js';
import { redactarAviso } from '../mensajes/contenido.js';
import { avisoPorCorreo, enlaceCorreo } from '../mensajes/correo.js';
import type { MomentoRecordatorio } from '../../domain/agenda.js';
import { hora } from '../mensajes/formato.js';

export interface AvisoDelDia {
  id: string;
  citaId: string;
  momento: MomentoRecordatorio;
  estado: string;
  /** Hora local a la que toca, ya en la zona de la clienta. */
  horaProgramada: string;
  programadoPara: Date;
  /** Verdadero cuando la hora ya pasó y el aviso sigue sin salir. */
  atrasado: boolean;
  clienta: string | null;
  celular: string;
  mascota: string;
  servicio: string;
  proveedor: string;
  /** El texto exacto que debe recibir la clienta. */
  texto: string;
  /** Cómo prefiere que le avisen: por WhatsApp, por correo o por los dos. */
  canalPreferido: 'whatsapp' | 'correo' | 'ambos';
  /** Abre WhatsApp con el texto ya escrito. */
  enlaceWhatsApp: string;
  /** Su correo, si lo dio. */
  correo: string | null;
  /** Asunto del correo; WhatsApp no lo necesita. */
  asunto: string | null;
  /** Abre el cliente de correo con todo puesto. `null` si no dio correo. */
  enlaceCorreo: string | null;
  /** Solo si el aviso no se pudo redactar; nunca debería pasar. */
  problema: string | null;
}

/**
 * Cómo se llama cada momento en la interfaz.
 *
 * Son las palabras del panel que ya se usa (docs/referencia-panel.html), no una
 * traducción nueva de los códigos internos: la operadora ya sabe lo que
 * significa «Preguntar fecha» y no tiene por qué aprender «T−21».
 */
export const ETIQUETA_MOMENTO: Record<MomentoRecordatorio, string> = {
  confirmacion: 'Confirmar la cita',
  t_21: 'Preguntar fecha',
  t_7: 'Aviso de 7 días',
  t_3: 'Aviso de 3 días',
  t_0: 'Aviso del día',
  cierre: 'Cerrar y programar',
};

/**
 * Los momentos que la referencia pinta en gris en vez de en camello, por ser
 * los de tono positivo.
 */
export const MOMENTOS_EN_GRIS: readonly MomentoRecordatorio[] = ['confirmacion', 't_0'];

/**
 * Arma el enlace de WhatsApp con el mensaje puesto.
 *
 * `wa.me` quiere el número sin el «+» ni separadores.
 */
export function enlaceWhatsApp(celular: string, texto: string): string {
  return `https://wa.me/${celular.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}

interface FilaAviso extends FilaRecordatorioVencido {
  estado: string;
  usuaria: string | null;
  enviado_en: Date | null;
}

/**
 * Avisos que tocan en una fecha, en la zona horaria de cada clienta.
 *
 * Incluye los que quedaron atrás sin salir, no solo los de hoy: un aviso
 * atrasado es precisamente el que hay que ver primero, y esconderlo porque su
 * fecha ya pasó sería perderlo.
 */
export async function avisosDelDia(
  pool: pg.Pool,
  fecha: string,
  opciones: { ahora?: Date } = {},
): Promise<AvisoDelDia[]> {
  const ahora = opciones.ahora ?? new Date();

  const { rows } = await pool.query<FilaAviso>(
    `${SQL_AVISO_COMPLETO}
      WHERE u.anonimizada_en IS NULL
        AND c.estado NOT IN ('cancelada', 'reagendada')
        AND (
              (r.estado IN ('programado', 'fallido')
                 AND (r.programado_para AT TIME ZONE u.zona_horaria)::date <= $1::date)
           OR (r.estado IN ('enviando', 'enviado', 'entregado', 'leido')
                 AND (r.programado_para AT TIME ZONE u.zona_horaria)::date = $1::date)
            )
      ORDER BY r.programado_para`,
    [fecha],
  );

  return rows.map((fila) => {
    const base = {
      id: fila.id,
      citaId: fila.cita_id,
      momento: fila.momento,
      estado: fila.estado,
      horaProgramada: hora(fila.programado_para, fila.zona_horaria),
      programadoPara: fila.programado_para,
      atrasado:
        ['programado', 'fallido'].includes(fila.estado) &&
        fila.programado_para.getTime() < ahora.getTime(),
      clienta: fila.usuaria,
      celular: fila.celular,
      correo: fila.correo,
      canalPreferido: fila.canal_preferido,
      mascota: fila.mascota,
      servicio: fila.servicio,
      proveedor: fila.proveedor,
    };

    try {
      const datos = datosDeAviso(fila);
      const aviso = redactarAviso(fila.momento, datos, opcionesParaAviso(fila));
      const porCorreo = fila.correo ? avisoPorCorreo(fila.momento, datos, aviso.texto) : null;

      return {
        ...base,
        texto: aviso.texto,
        enlaceWhatsApp: enlaceWhatsApp(fila.celular, aviso.texto),
        asunto: porCorreo?.asunto ?? null,
        enlaceCorreo: porCorreo ? enlaceCorreo(fila.correo!, porCorreo) : null,
        problema: null,
      };
    } catch (error) {
      // Un aviso que no se puede redactar no debe tumbar la pantalla entera: se
      // muestra el problema para que la operadora lo escale.
      return {
        ...base,
        texto: '',
        enlaceWhatsApp: '',
        asunto: null,
        enlaceCorreo: null,
        problema: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/**
 * Marca un aviso como enviado a mano por la operadora.
 *
 * Es el gesto central de la Fase 1: el sistema dice qué toca, la persona lo
 * manda por WhatsApp y vuelve a picar aquí. Se guarda el texto exacto y el
 * retraso real, igual que si lo hubiera mandado el barrido automático, para que
 * la bitácora y la medición de RNF-03 no tengan huecos según quién lo envió.
 */
export async function marcarEnviadoAMano(
  pool: pg.Pool,
  recordatorioId: string,
  opciones: { texto: string; operadorId: string; canal?: 'whatsapp' | 'correo'; ahora?: Date },
): Promise<boolean> {
  const ahora = opciones.ahora ?? new Date();
  // Queda anotado por dónde salió: al cabo del piloto eso dice qué canal usan
  // de verdad las clientas, que es una de las cosas que el piloto va a medir.
  const canal = `${opciones.canal ?? 'whatsapp'}_manual`;

  const { rows } = await pool.query<{ programado_para: Date }>(
    `UPDATE recordatorio
        SET estado = 'enviado',
            enviado_en = $2,
            contenido_enviado = $3,
            canal = $4,
            intentos = intentos + 1,
            retraso_segundos = GREATEST(0, EXTRACT(EPOCH FROM ($2 - programado_para))::int),
            ultimo_error = NULL,
            proximo_intento_en = NULL
      WHERE id = $1
        AND estado IN ('programado', 'fallido', 'enviando')
      RETURNING programado_para`,
    [recordatorioId, ahora, opciones.texto, canal],
  );

  if (rows.length === 0) return false;

  await pool.query(
    `INSERT INTO bitacora_agente (accion, detalle)
     VALUES ('aviso_enviado_a_mano', $1)`,
    [JSON.stringify({ recordatorioId, operadorId: opciones.operadorId, canal })],
  );

  return true;
}
