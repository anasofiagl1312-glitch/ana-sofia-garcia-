/**
 * Los números del piloto — pestaña «Números».
 *
 * Son los mismos siete de docs/referencia-panel.html, con las mismas palabras:
 * lo que el equipo ya mira para saber si el piloto va bien, y lo que se le
 * enseña a un ingeniero o a un inversionista.
 *
 * Va en su propio módulo, y no embebido en la ruta, por una razón práctica:
 * así se puede probar. Una consulta metida dentro de un `panel.get(...)` solo
 * se ejerce levantando el servidor, y estas cifras son justo las que nadie
 * nota cuando se rompen.
 */
import type pg from 'pg';

export interface NumerosDelPiloto {
  /** Todas las que alguna vez se dieron de alta. */
  personasInvitadas: number;
  /** Las que siguen dentro: en prueba o pagando. */
  clientasActivas: number;
  /** Las que ya pagan. */
  pagando: number;
  /** Activas entre invitadas, en porcentaje. `null` si todavía no hay nadie. */
  tasaAceptacion: number | null;
  citasAgendadas: number;
  citasCumplidas: number;
  /** Avisos que hoy siguen sin salir, incluidos los que quedaron atrás. */
  pendientesDeHoy: number;
}

/**
 * Estados de suscripción que cuentan como clienta activa.
 *
 * `prueba` cuenta: está usando el producto aunque todavía no pague, que es
 * exactamente lo que el piloto quiere medir. `pago_pendiente` también, porque
 * un cobro que falló casi siempre es una tarjeta vencida y no una baja.
 */
const ACTIVAS = ['prueba', 'activa', 'pago_pendiente'];

export async function numerosDelPiloto(
  pool: pg.Pool,
  opciones: { fecha?: string } = {},
): Promise<NumerosDelPiloto> {
  const fecha = opciones.fecha ?? new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query<{
    invitadas: number;
    activas: number;
    pagando: number;
    agendadas: number;
    cumplidas: number;
    pendientes: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM usuaria
         WHERE anonimizada_en IS NULL) AS invitadas,

       (SELECT count(*)::int FROM usuaria
         WHERE anonimizada_en IS NULL
           AND estado = ANY($2::estado_suscripcion[])) AS activas,

       (SELECT count(*)::int FROM usuaria
         WHERE anonimizada_en IS NULL
           AND estado = 'activa') AS pagando,

       (SELECT count(*)::int FROM cita
         WHERE estado NOT IN ('cancelada', 'reagendada')) AS agendadas,

       (SELECT count(*)::int FROM cita
         WHERE estado = 'cumplida') AS cumplidas,

       -- El mismo criterio que la pestaña «Hoy»: lo de hoy y lo que quedó
       -- atrás sin salir. Un aviso atrasado sigue pendiente.
       (SELECT count(*)::int
          FROM recordatorio r
          JOIN cita c    ON c.id = r.cita_id
          JOIN usuaria u ON u.id = r.usuaria_id
         WHERE u.anonimizada_en IS NULL
           AND c.estado NOT IN ('cancelada', 'reagendada')
           AND r.estado IN ('programado', 'fallido')
           AND (r.programado_para AT TIME ZONE u.zona_horaria)::date <= $1::date) AS pendientes`,
    [fecha, ACTIVAS],
  );

  const r = rows[0]!;

  return {
    personasInvitadas: r.invitadas,
    clientasActivas: r.activas,
    pagando: r.pagando,
    // Sin nadie invitada la tasa no es 0 %, es que no hay tasa. Devolver 0
    // haría ver el piloto como un fracaso el primer día.
    tasaAceptacion: r.invitadas === 0 ? null : Math.round((r.activas / r.invitadas) * 100),
    citasAgendadas: r.agendadas,
    citasCumplidas: r.cumplidas,
    pendientesDeHoy: r.pendientes,
  };
}
