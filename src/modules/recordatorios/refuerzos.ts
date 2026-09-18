/**
 * RF-14: alertas por vencimiento de vacuna o desparasitacion.
 *
 * Son "independientes" en el sentido del requerimiento: no cuelgan de una cita.
 * La usuaria las recibe porque su carnet dice que el refuerzo vence, aunque
 * nunca haya agendado nada.
 *
 * El barrido separa GENERAR de ENVIAR. Generar inserta una fila por hito
 * (catorce dias antes, el dia, siete y treinta despues) con una llave unica que
 * hace imposible mandar dos veces el mismo aviso aunque el barrido corra cada
 * hora. Enviar toma lo generado y lo saca. Esa separacion es la que permite
 * cargar un carnet viejo sin que se dispare una avalancha.
 */
import type pg from 'pg';
import {
  type AplicacionRegistrada,
  type ClaseAlerta,
  alertasDeRefuerzo,
} from '../../domain/vacunas.js';
import type { FechaLocal } from '../../domain/tiempo.js';
import { fechaLargaDeFechaLocal } from '../mensajes/formato.js';
import { PLANTILLAS, renderizar } from '../../channels/whatsapp/plantillas.js';
import { ErrorEnvio } from '../../channels/whatsapp/index.js';
import {
  BACKOFF_SEGUNDOS,
  type DependenciasEnvio,
  MAX_INTENTOS,
  RELOJ_DEL_SISTEMA,
  abrirCaso,
} from './servicio.js';

interface FilaUsuariaConAplicaciones {
  usuaria_id: string;
  zona_horaria: string;
  aplicaciones: Array<{
    id: string;
    mascotaId: string;
    producto: string;
    tipoServicio: string | null;
    fechaAplicacion: FechaLocal;
    fechaRefuerzo: FechaLocal | null;
  }> | null;
}

/** Genera las filas de alerta que corresponden hoy. Idempotente. */
export async function generarAlertasDeRefuerzo(
  pool: pg.Pool,
  opciones: { ahora?: Date } = {},
): Promise<{ generadas: number }> {
  const ahora = opciones.ahora ?? new Date();

  const { rows: periodicidades } = await pool.query<{ codigo: string; periodicidad_dias: number | null }>(
    `SELECT codigo, periodicidad_dias FROM tipo_servicio`,
  );
  const periodicidadPorServicio = Object.fromEntries(
    periodicidades.map((p) => [p.codigo, p.periodicidad_dias]),
  ) as Record<string, number | null>;

  const { rows } = await pool.query<FilaUsuariaConAplicaciones>(
    `SELECT u.id AS usuaria_id, u.zona_horaria,
            (SELECT json_agg(json_build_object(
                      'id', a.id,
                      'mascotaId', a.mascota_id,
                      'producto', a.producto,
                      'tipoServicio', a.tipo_servicio,
                      'fechaAplicacion', a.fecha_aplicacion,
                      'fechaRefuerzo', a.fecha_refuerzo))
               FROM aplicacion a
               JOIN mascota m ON m.id = a.mascota_id
              WHERE m.usuaria_id = u.id AND m.archivada_en IS NULL) AS aplicaciones
       FROM usuaria u
      WHERE u.anonimizada_en IS NULL AND u.estado <> 'cancelada'`,
  );

  let generadas = 0;

  for (const fila of rows) {
    if (!fila.aplicaciones?.length) continue;

    const alertas = alertasDeRefuerzo(
      fila.aplicaciones as AplicacionRegistrada[],
      periodicidadPorServicio,
      fila.zona_horaria,
      ahora,
    );

    for (const alerta of alertas) {
      const resultado = await pool.query(
        `INSERT INTO alerta_refuerzo
           (usuaria_id, mascota_id, aplicacion_id, clase, fecha_refuerzo, dias_de_retraso, programado_para)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (aplicacion_id, dias_de_retraso) DO NOTHING`,
        [
          fila.usuaria_id,
          alerta.mascotaId,
          alerta.aplicacionId,
          alerta.clase,
          alerta.fechaRefuerzo,
          alerta.diasDeRetraso,
          alerta.programadoPara,
        ],
      );
      generadas += resultado.rowCount ?? 0;
    }
  }

  return { generadas };
}

/** Texto del vencimiento segun que tan cerca o lejos quedo. */
export function textoVencimiento(clase: ClaseAlerta, fecha: FechaLocal, diasDeRetraso: number): string {
  const larga = fechaLargaDeFechaLocal(fecha);
  if (clase === 'hoy') return `el refuerzo vence hoy, ${larga}`;
  if (clase === 'proxima') return `el refuerzo vence el ${larga}`;
  const dias = diasDeRetraso === 1 ? 'un día' : `${diasDeRetraso} días`;
  return `el refuerzo venció el ${larga}, hace ${dias}`;
}

interface FilaAlertaPendiente {
  id: string;
  usuaria_id: string;
  clase: ClaseAlerta;
  fecha_refuerzo: FechaLocal;
  dias_de_retraso: number;
  programado_para: Date;
  intentos: number;
  producto: string;
  mascota: string;
  celular: string;
}

export async function enviarAlertasDeRefuerzo(
  deps: DependenciasEnvio,
  opciones: { limite?: number } = {},
): Promise<{ enviadas: number; fallidas: number }> {
  const reloj = deps.reloj ?? RELOJ_DEL_SISTEMA;
  const ahora = reloj.ahora();

  const { rows } = await deps.pool.query<FilaAlertaPendiente>(
    `SELECT ar.id, ar.usuaria_id, ar.clase, ar.fecha_refuerzo, ar.dias_de_retraso,
            ar.programado_para, ar.intentos,
            ap.producto, m.nombre AS mascota, u.celular
       FROM alerta_refuerzo ar
       JOIN aplicacion ap ON ap.id = ar.aplicacion_id
       JOIN mascota m     ON m.id = ar.mascota_id
       JOIN usuaria u     ON u.id = ar.usuaria_id
      WHERE ar.estado IN ('programado','fallido')
        AND COALESCE(ar.proximo_intento_en, ar.programado_para) <= $1
        AND u.anonimizada_en IS NULL
      ORDER BY ar.programado_para
      LIMIT $2`,
    [ahora, opciones.limite ?? 200],
  );

  let enviadas = 0;
  let fallidas = 0;

  for (const fila of rows) {
    const variables = [
      fila.mascota,
      fila.producto,
      textoVencimiento(fila.clase, fila.fecha_refuerzo, fila.dias_de_retraso),
    ];

    try {
      const texto = renderizar(PLANTILLAS.huella_refuerzo_v1, variables);
      const { idExterno } = await deps.whatsapp.enviarPlantilla({
        a: fila.celular,
        plantilla: 'huella_refuerzo_v1',
        variables,
      });

      await deps.pool.query(
        `UPDATE alerta_refuerzo
            SET estado = 'enviado', enviado_en = $2, contenido_enviado = $3,
                plantilla = 'huella_refuerzo_v1', id_externo = $4,
                intentos = intentos + 1, ultimo_error = NULL, proximo_intento_en = NULL
          WHERE id = $1`,
        [fila.id, ahora, texto, idExterno],
      );
      enviadas += 1;
    } catch (error) {
      const intentos = fila.intentos + 1;
      const reintentable = error instanceof ErrorEnvio ? error.reintentable : true;
      const quedan = reintentable && intentos < MAX_INTENTOS;
      const mensaje = error instanceof Error ? error.message : String(error);

      await deps.pool.query(
        `UPDATE alerta_refuerzo
            SET estado = 'fallido', intentos = $2, ultimo_error = $3, proximo_intento_en = $4
          WHERE id = $1`,
        [
          fila.id,
          intentos,
          mensaje.slice(0, 500),
          quedan ? new Date(ahora.getTime() + (BACKOFF_SEGUNDOS[intentos - 1] ?? 240) * 1000) : null,
        ],
      );

      if (!quedan) {
        await abrirCaso(deps.pool, {
          usuariaId: fila.usuaria_id,
          motivo: 'envio_fallido',
          detalle: `La alerta de refuerzo de ${fila.producto} para ${fila.mascota} fallo ${intentos} veces.`,
        });
      }
      fallidas += 1;
    }
  }

  return { enviadas, fallidas };
}
