/**
 * Disparo de la consulta de disponibilidad (RF-08) y cierre del ciclo (T+1).
 *
 * Es la pieza que convierte una rutina en una cita concreta. Sigue la secuencia
 * de la seccion 03 al pie de la letra, que segun el documento "es el corazon
 * del producto y debe respetarse tal cual".
 */
import type pg from 'pg';
import type { Ejecutor } from '../../db/pool.js';
import { enTransaccion } from '../../db/pool.js';
import { instanteDeConsultaDisponibilidad, siguienteFechaEstimada } from '../../domain/agenda.js';
import { asegurarTransicion } from '../../domain/citas.js';
import { type FechaLocal, fechaLocalDe, instanteDesdeLocal } from '../../domain/tiempo.js';
import { programarRecordatoriosDeCita, reprogramarRecordatorios } from '../recordatorios/servicio.js';

interface FilaRutinaPorDisparar {
  id: string;
  usuaria_id: string;
  mascota_id: string;
  proveedor_id: string;
  tipo_servicio: string;
  proxima_fecha_estimada: FechaLocal;
  dias_anticipacion: number;
  hora_preferida: string;
  costo_referencia: number | null;
  zona_horaria: string;
}

/**
 * Crea la cita y programa el aviso de T-21 para las rutinas que ya toca
 * preguntar.
 *
 * Se apoya en `rutina.cita_generada_para` para no preguntar dos veces por el
 * mismo ciclo, asi que puede correr tan seguido como haga falta.
 */
export async function dispararConsultasDeDisponibilidad(
  pool: pg.Pool,
  opciones: { ahora?: Date; limite?: number } = {},
): Promise<{ citasCreadas: number }> {
  const ahora = opciones.ahora ?? new Date();

  const { rows } = await pool.query<FilaRutinaPorDisparar>(
    `SELECT r.id, r.usuaria_id, r.mascota_id, r.proveedor_id, r.tipo_servicio,
            r.proxima_fecha_estimada, r.dias_anticipacion, r.hora_preferida, r.costo_referencia,
            u.zona_horaria
       FROM rutina r
       JOIN usuaria u ON u.id = r.usuaria_id
      WHERE r.activa
        AND u.anonimizada_en IS NULL
        AND u.estado <> 'cancelada'
        AND r.cita_generada_para IS DISTINCT FROM r.proxima_fecha_estimada
      ORDER BY r.proxima_fecha_estimada
      LIMIT $1`,
    [opciones.limite ?? 200],
  );

  let citasCreadas = 0;

  for (const rutina of rows) {
    const disparo = instanteDeConsultaDisponibilidad(
      rutina.proxima_fecha_estimada,
      rutina.dias_anticipacion,
      rutina.zona_horaria,
    );
    if (disparo.getTime() > ahora.getTime()) continue;

    await enTransaccion(pool, async (cliente) => {
      // Se vuelve a leer con bloqueo: dos barridos simultaneos no deben crear
      // dos citas para el mismo ciclo.
      const { rows: bloqueadas } = await cliente.query<{ cita_generada_para: FechaLocal | null }>(
        `SELECT cita_generada_para FROM rutina WHERE id = $1 FOR UPDATE`,
        [rutina.id],
      );
      if (bloqueadas[0]?.cita_generada_para === rutina.proxima_fecha_estimada) return;

      const iniciaEn = instanteDesdeLocal(
        rutina.proxima_fecha_estimada,
        rutina.hora_preferida,
        rutina.zona_horaria,
      );

      const { rows: creadas } = await cliente.query<{ id: string }>(
        `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, rutina_id, tipo_servicio,
                           estado, inicia_en, costo_confirmado)
         VALUES ($1, $2, $3, $4, $5, 'solicitada', $6, $7)
         RETURNING id`,
        [
          rutina.usuaria_id,
          rutina.mascota_id,
          rutina.proveedor_id,
          rutina.id,
          rutina.tipo_servicio,
          iniciaEn,
          // El costo de referencia de la rutina es una estimacion util mientras
          // el proveedor no confirme; si no hay, la cita nace "por confirmar".
          rutina.costo_referencia,
        ],
      );

      const citaId = creadas[0]!.id;

      await cliente.query(`UPDATE rutina SET cita_generada_para = $2, actualizada_en = now() WHERE id = $1`, [
        rutina.id,
        rutina.proxima_fecha_estimada,
      ]);

      // Solo el aviso de T-21. Los de T-7, T-3 y T-0 se programan cuando la
      // cita queda confirmada con fecha y hora reales.
      await cliente.query(
        `INSERT INTO recordatorio (cita_id, usuaria_id, momento, programado_para)
         VALUES ($1, $2, 't_21', $3)
         ON CONFLICT (cita_id, momento) DO NOTHING`,
        [citaId, rutina.usuaria_id, disparo],
      );

      citasCreadas += 1;
    });
  }

  return { citasCreadas };
}

/**
 * La usuaria eligio dia y franja: la cita pasa a "por confirmar con proveedor".
 */
export async function registrarEleccionDeHorario(
  ejecutor: Ejecutor,
  citaId: string,
  iniciaEn: Date,
): Promise<void> {
  const { rows } = await ejecutor.query<{ estado: Parameters<typeof asegurarTransicion>[0] }>(
    `SELECT estado FROM cita WHERE id = $1`,
    [citaId],
  );
  const actual = rows[0];
  if (!actual) throw new Error(`No existe la cita ${citaId}`);
  asegurarTransicion(actual.estado, 'por_confirmar_con_proveedor');

  await ejecutor.query(
    `UPDATE cita SET estado = 'por_confirmar_con_proveedor', inicia_en = $2, actualizada_en = now()
      WHERE id = $1`,
    [citaId, iniciaEn],
  );
}

/**
 * El proveedor aparto la cita: se confirma, se guarda el costo y salen los
 * recordatorios de T-7, T-3 y T-0.
 *
 * `costoConfirmado` en null deja la cita como "costo por confirmar" y asi se le
 * comunica a la usuaria (seccion 05).
 */
export async function confirmarCita(
  pool: pg.Pool,
  citaId: string,
  datos: { iniciaEn?: Date; costoConfirmado?: number | null; indicaciones?: string | null; ahora?: Date },
): Promise<void> {
  await enTransaccion(pool, async (cliente) => {
    const { rows } = await cliente.query<{ estado: Parameters<typeof asegurarTransicion>[0] }>(
      `SELECT estado FROM cita WHERE id = $1 FOR UPDATE`,
      [citaId],
    );
    const actual = rows[0];
    if (!actual) throw new Error(`No existe la cita ${citaId}`);
    asegurarTransicion(actual.estado, 'confirmada');

    await cliente.query(
      `UPDATE cita
          SET estado = 'confirmada',
              inicia_en = COALESCE($2, inicia_en),
              costo_confirmado = $3,
              indicaciones = COALESCE($4, indicaciones),
              actualizada_en = now()
        WHERE id = $1`,
      [citaId, datos.iniciaEn ?? null, datos.costoConfirmado ?? null, datos.indicaciones ?? null],
    );

    await programarRecordatoriosDeCita(cliente, citaId, {
      ahora: datos.ahora ?? new Date(),
      momentos: ['t_7', 't_3', 't_0', 'cierre'],
    });
  });
}

/**
 * RF-11: reagendar. Se mueve la fecha y se recalculan los avisos pendientes,
 * que es justamente lo que pide el criterio de aceptacion de la seccion 12.
 */
export async function reagendarCita(
  pool: pg.Pool,
  citaId: string,
  nuevaFecha: Date,
  opciones: { ahora?: Date } = {},
): Promise<void> {
  await enTransaccion(pool, async (cliente) => {
    const { rows } = await cliente.query<{ estado: Parameters<typeof asegurarTransicion>[0] }>(
      `SELECT estado FROM cita WHERE id = $1 FOR UPDATE`,
      [citaId],
    );
    const actual = rows[0];
    if (!actual) throw new Error(`No existe la cita ${citaId}`);
    // Reagendar no cambia el estado de la cita: sigue confirmada, en otra fecha.
    // El estado `reagendada` es para la cita VIEJA cuando se sustituye por otra.
    if (actual.estado === 'cancelada' || actual.estado === 'cumplida' || actual.estado === 'reagendada') {
      throw new Error(`Una cita en estado "${actual.estado}" ya no se puede reagendar.`);
    }

    await cliente.query(`UPDATE cita SET inicia_en = $2, actualizada_en = now() WHERE id = $1`, [
      citaId,
      nuevaFecha,
    ]);

    await reprogramarRecordatorios(cliente, citaId, { ahora: opciones.ahora ?? new Date() });
  });
}

/**
 * Cierre de T+1: la cita se cumplio, se registra el costo real y se programa el
 * siguiente ciclo de la rutina.
 */
export async function cerrarCita(
  pool: pg.Pool,
  citaId: string,
  datos: { costoReal?: number | null; ahora?: Date } = {},
): Promise<{ siguienteFecha: FechaLocal | null }> {
  return enTransaccion(pool, async (cliente) => {
    const { rows } = await cliente.query<{
      estado: Parameters<typeof asegurarTransicion>[0];
      rutina_id: string | null;
      inicia_en: Date;
      zona_horaria: string;
    }>(
      `SELECT c.estado, c.rutina_id, c.inicia_en, u.zona_horaria
         FROM cita c JOIN usuaria u ON u.id = c.usuaria_id
        WHERE c.id = $1 FOR UPDATE OF c`,
      [citaId],
    );
    const cita = rows[0];
    if (!cita) throw new Error(`No existe la cita ${citaId}`);
    asegurarTransicion(cita.estado, 'cumplida');

    await cliente.query(
      `UPDATE cita SET estado = 'cumplida', costo_real = COALESCE($2, costo_real), actualizada_en = now()
        WHERE id = $1`,
      [citaId, datos.costoReal ?? null],
    );

    if (!cita.rutina_id) return { siguienteFecha: null };

    const { rows: rutinas } = await cliente.query<{
      frecuencia_cantidad: number;
      frecuencia_unidad: 'semanas' | 'meses';
    }>(`SELECT frecuencia_cantidad, frecuencia_unidad FROM rutina WHERE id = $1 FOR UPDATE`, [cita.rutina_id]);
    const rutina = rutinas[0];
    if (!rutina) return { siguienteFecha: null };

    // Se cuenta desde el dia en que la cita REALMENTE ocurrio, para que la
    // rutina no arrastre el desfase de los recorridos.
    const fechaCumplida = fechaLocalDe(cita.inicia_en, cita.zona_horaria);
    const siguienteFecha = siguienteFechaEstimada(
      fechaCumplida,
      rutina.frecuencia_cantidad,
      rutina.frecuencia_unidad,
    );

    await cliente.query(
      `UPDATE rutina SET proxima_fecha_estimada = $2, cita_generada_para = NULL, actualizada_en = now()
        WHERE id = $1`,
      [cita.rutina_id, siguienteFecha],
    );

    return { siguienteFecha };
  });
}
