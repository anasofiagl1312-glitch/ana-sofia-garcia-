/**
 * RF-23: "Cobro de suscripcion mensual con tarjeta o domiciliacion, con periodo
 * de prueba y cancelacion desde la misma conversacion."
 *
 * Y la seccion 09: "Baja de suscripcion tan sencilla como el alta."
 *
 * La pasarela concreta queda detras de una interfaz. Para Mexico hay que elegir
 * una que acepte tarjetas nacionales y domiciliacion; la recomendacion esta en
 * docs/respuesta-tecnica.md. Lo que no cambia con la pasarela es lo de aqui:
 * cuando empieza la prueba, cuando se cobra y que pasa si el cobro falla.
 */
import type pg from 'pg';
import type { Ejecutor } from '../../db/pool.js';
import { enTransaccion } from '../../db/pool.js';

export type EstadoSuscripcion = 'prueba' | 'activa' | 'pago_pendiente' | 'cancelada';

export interface Pasarela {
  crearSuscripcion(datos: { usuariaId: string; celular: string }): Promise<{ idExterno: string }>;
  cancelarSuscripcion(idExterno: string): Promise<void>;
  cobrar(datos: { idExterno: string; monto: number }): Promise<{ idCobro: string; exitoso: boolean }>;
}

/** Pasarela falsa, para desarrollo y pruebas. */
export class PasarelaFalsa implements Pasarela {
  cobrosFallan = false;
  readonly cobros: Array<{ idExterno: string; monto: number; exitoso: boolean }> = [];
  private n = 0;

  async crearSuscripcion(): Promise<{ idExterno: string }> {
    this.n += 1;
    return { idExterno: `sub_falsa_${this.n}` };
  }

  async cancelarSuscripcion(): Promise<void> {}

  async cobrar(datos: { idExterno: string; monto: number }): Promise<{ idCobro: string; exitoso: boolean }> {
    this.n += 1;
    const exitoso = !this.cobrosFallan;
    this.cobros.push({ ...datos, exitoso });
    return { idCobro: `pago_falso_${this.n}`, exitoso };
  }
}

/**
 * Da de alta la suscripcion con su periodo de prueba.
 *
 * La prueba arranca sin cobrar nada: el producto no demuestra su valor hasta
 * que sale el primer recordatorio completo, y eso tarda semanas.
 */
export async function iniciarSuscripcion(
  pool: pg.Pool,
  usuariaId: string,
  opciones: { diasPrueba: number; precioMensual: number; pasarela: Pasarela; ahora?: Date },
): Promise<{ suscripcionId: string; pruebaTerminaEn: Date }> {
  const ahora = opciones.ahora ?? new Date();
  const pruebaTerminaEn = new Date(ahora.getTime() + opciones.diasPrueba * 24 * 60 * 60 * 1000);

  return enTransaccion(pool, async (cliente) => {
    const { rows: usuarias } = await cliente.query<{ celular: string }>(
      `SELECT celular FROM usuaria WHERE id = $1`,
      [usuariaId],
    );
    const usuaria = usuarias[0];
    if (!usuaria) throw new Error(`No existe la usuaria ${usuariaId}`);

    const { idExterno } = await opciones.pasarela.crearSuscripcion({ usuariaId, celular: usuaria.celular });

    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO suscripcion (usuaria_id, estado, prueba_termina_en, periodo_actual_termina_en,
                                precio_mensual, id_externo)
       VALUES ($1,'prueba',$2,$2,$3,$4)
       RETURNING id`,
      [usuariaId, pruebaTerminaEn, opciones.precioMensual, idExterno],
    );

    await cliente.query(`UPDATE usuaria SET estado = 'prueba' WHERE id = $1`, [usuariaId]);
    return { suscripcionId: rows[0]!.id, pruebaTerminaEn };
  });
}

/**
 * Cancelacion. Un paso, sin preguntas de retencion.
 *
 * La suscripcion sigue valida hasta el final del periodo ya pagado: cobrar un
 * mes y cortar el servicio el mismo dia seria quedarse con dinero ajeno.
 */
export async function cancelarSuscripcion(
  pool: pg.Pool,
  usuariaId: string,
  opciones: { pasarela: Pasarela; ahora?: Date },
): Promise<{ sirveHasta: Date | null }> {
  const ahora = opciones.ahora ?? new Date();

  return enTransaccion(pool, async (cliente) => {
    const { rows } = await cliente.query<{ id: string; id_externo: string | null; periodo_actual_termina_en: Date | null }>(
      `SELECT id, id_externo, periodo_actual_termina_en
         FROM suscripcion WHERE usuaria_id = $1 AND cancelada_en IS NULL FOR UPDATE`,
      [usuariaId],
    );
    const suscripcion = rows[0];
    if (!suscripcion) return { sirveHasta: null };

    if (suscripcion.id_externo) await opciones.pasarela.cancelarSuscripcion(suscripcion.id_externo);

    await cliente.query(
      `UPDATE suscripcion SET estado = 'cancelada', cancelada_en = $2, actualizada_en = now() WHERE id = $1`,
      [suscripcion.id, ahora],
    );
    await cliente.query(`UPDATE usuaria SET estado = 'cancelada' WHERE id = $1`, [usuariaId]);

    // Las rutinas se pausan, no se borran: si vuelve, no tiene que capturarlo
    // todo otra vez.
    await cliente.query(`UPDATE rutina SET activa = false WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(
      `UPDATE recordatorio SET estado = 'cancelado'
        WHERE usuaria_id = $1 AND estado IN ('programado','fallido')`,
      [usuariaId],
    );

    return { sirveHasta: suscripcion.periodo_actual_termina_en };
  });
}

/** Cobra las suscripciones cuyo periodo vencio. */
export async function cobrarVencidas(
  pool: pg.Pool,
  opciones: { pasarela: Pasarela; ahora?: Date },
): Promise<{ cobradas: number; fallidas: number }> {
  const ahora = opciones.ahora ?? new Date();

  const { rows } = await pool.query<{
    id: string;
    usuaria_id: string;
    id_externo: string | null;
    precio_mensual: number;
  }>(
    `SELECT id, usuaria_id, id_externo, precio_mensual
       FROM suscripcion
      WHERE cancelada_en IS NULL
        AND estado IN ('prueba','activa','pago_pendiente')
        AND periodo_actual_termina_en <= $1`,
    [ahora],
  );

  let cobradas = 0;
  let fallidas = 0;

  for (const s of rows) {
    if (!s.id_externo) continue;
    const resultado = await opciones.pasarela.cobrar({ idExterno: s.id_externo, monto: s.precio_mensual });

    await pool.query(
      `INSERT INTO cobro (suscripcion_id, monto, estado, id_externo) VALUES ($1,$2,$3,$4)`,
      [s.id, s.precio_mensual, resultado.exitoso ? 'exitoso' : 'fallido', resultado.idCobro],
    );

    if (resultado.exitoso) {
      const siguiente = new Date(ahora.getTime());
      siguiente.setUTCMonth(siguiente.getUTCMonth() + 1);
      await pool.query(
        `UPDATE suscripcion SET estado = 'activa', periodo_actual_termina_en = $2, actualizada_en = now()
          WHERE id = $1`,
        [s.id, siguiente],
      );
      await pool.query(`UPDATE usuaria SET estado = 'activa' WHERE id = $1`, [s.usuaria_id]);
      cobradas += 1;
    } else {
      // Un cobro fallido NO corta el servicio de inmediato: casi siempre es una
      // tarjeta vencida, y dejar a la usuaria sin recordatorios por eso es
      // perder a alguien que si queria pagar.
      await pool.query(
        `UPDATE suscripcion SET estado = 'pago_pendiente', actualizada_en = now() WHERE id = $1`,
        [s.id],
      );
      await pool.query(`UPDATE usuaria SET estado = 'pago_pendiente' WHERE id = $1`, [s.usuaria_id]);
      fallidas += 1;
    }
  }

  return { cobradas, fallidas };
}

export async function estadoDeSuscripcion(
  ejecutor: Ejecutor,
  usuariaId: string,
): Promise<{ estado: EstadoSuscripcion; pruebaTerminaEn: Date | null; periodoTerminaEn: Date | null } | null> {
  const { rows } = await ejecutor.query<{
    estado: EstadoSuscripcion;
    prueba_termina_en: Date | null;
    periodo_actual_termina_en: Date | null;
  }>(
    `SELECT estado, prueba_termina_en, periodo_actual_termina_en
       FROM suscripcion WHERE usuaria_id = $1 ORDER BY creada_en DESC LIMIT 1`,
    [usuariaId],
  );
  const s = rows[0];
  if (!s) return null;
  return {
    estado: s.estado,
    pruebaTerminaEn: s.prueba_termina_en,
    periodoTerminaEn: s.periodo_actual_termina_en,
  };
}
