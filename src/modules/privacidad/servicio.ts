/**
 * Derechos ARCO (seccion 09).
 *
 * "Derechos de acceso, rectificacion, cancelacion y oposicion: debe existir la
 *  forma de exportar y de borrar todos los datos de una usuaria a solicitud."
 *
 * Dos operaciones, y las dos tienen trampa:
 *
 *   - EXPORTAR tiene que traer TODO lo que el sistema sabe de ella, incluidas
 *     las conversaciones que el agente tuvo con proveedores a su nombre. Es
 *     facil olvidar esas y entregar una exportacion incompleta.
 *
 *   - BORRAR no puede ser un DELETE en cascada. Hay dos cosas que deben
 *     sobrevivir: los registros contables de cobros (obligacion fiscal) y el
 *     proveedor compartido (que es de todas las usuarias, no de ella). Por eso
 *     se anonimiza la usuaria y se borra lo que si es suyo.
 */
import type pg from 'pg';
import { randomBytes } from 'node:crypto';
import { enTransaccion } from '../../db/pool.js';
import type { Almacen } from '../almacenamiento/index.js';

export interface ExportacionUsuaria {
  generadaEn: string;
  usuaria: Record<string, unknown>;
  consentimientos: unknown[];
  preferenciasDeAgenda: unknown[];
  mascotas: unknown[];
  proveedores: unknown[];
  rutinas: unknown[];
  citas: unknown[];
  recordatorios: unknown[];
  documentos: unknown[];
  aplicaciones: unknown[];
  interaccionesConProveedores: unknown[];
  suscripcion: unknown[];
  cobros: unknown[];
}

/** Derecho de acceso: todo lo que el sistema sabe de ella, en un solo objeto. */
export async function exportarDatos(pool: pg.Pool, usuariaId: string): Promise<ExportacionUsuaria> {
  const uno = async (sql: string): Promise<unknown[]> => (await pool.query(sql, [usuariaId])).rows;

  const usuaria = (
    await pool.query(
      `SELECT id, celular, nombre, zona_horaria, hora_aviso_dia, estado, creada_en
         FROM usuaria WHERE id = $1`,
      [usuariaId],
    )
  ).rows[0];

  return {
    generadaEn: new Date().toISOString(),
    usuaria: (usuaria ?? {}) as Record<string, unknown>,
    consentimientos: await uno(
      `SELECT tipo, version, aceptado_en, revocado_en FROM consentimiento WHERE usuaria_id = $1`,
    ),
    preferenciasDeAgenda: await uno(
      `SELECT dia_semana, hora_inicio, hora_fin, prioridad FROM preferencia_agenda WHERE usuaria_id = $1`,
    ),
    mascotas: await uno(`SELECT * FROM mascota WHERE usuaria_id = $1`),
    proveedores: await uno(
      `SELECT p.negocio, p.sucursal, p.direccion, p.telefono, p.whatsapp, up.alias, up.notas, up.agregado_en
         FROM usuaria_proveedor up JOIN proveedor p ON p.id = up.proveedor_id
        WHERE up.usuaria_id = $1`,
    ),
    rutinas: await uno(`SELECT * FROM rutina WHERE usuaria_id = $1`),
    citas: await uno(`SELECT * FROM cita WHERE usuaria_id = $1`),
    recordatorios: await uno(
      `SELECT momento, canal, programado_para, contenido_enviado, estado, enviado_en, entregado_en, leido_en
         FROM recordatorio WHERE usuaria_id = $1`,
    ),
    documentos: await uno(
      `SELECT id, tipo, nombre_original, tipo_mime, bytes, cargado_en FROM documento WHERE usuaria_id = $1`,
    ),
    aplicaciones: await uno(
      `SELECT a.* FROM aplicacion a JOIN mascota m ON m.id = a.mascota_id WHERE m.usuaria_id = $1`,
    ),
    // Las conversaciones que el agente tuvo A SU NOMBRE con los proveedores son
    // datos suyos y deben ir en la exportacion.
    interaccionesConProveedores: await uno(
      `SELECT i.canal, i.direccion, i.contenido, i.resultado, i.ocurrio_en, p.negocio, p.sucursal
         FROM interaccion i
         LEFT JOIN proveedor p ON p.id = i.proveedor_id
        WHERE i.usuaria_id = $1
           OR i.cita_id IN (SELECT id FROM cita WHERE usuaria_id = $1)`,
    ),
    suscripcion: await uno(
      `SELECT estado, prueba_termina_en, periodo_actual_termina_en, precio_mensual, cancelada_en, creada_en
         FROM suscripcion WHERE usuaria_id = $1`,
    ),
    cobros: await uno(
      `SELECT c.monto, c.estado, c.ocurrio_en
         FROM cobro c JOIN suscripcion s ON s.id = c.suscripcion_id
        WHERE s.usuaria_id = $1`,
    ),
  };
}

export interface ResultadoBorrado {
  documentosBorrados: number;
  mascotasBorradas: number;
  citasBorradas: number;
}

/**
 * Derecho de cancelacion: borra los datos personales de la usuaria.
 *
 * Que se borra: mascotas, documentos (tambien del almacen de archivos, no solo
 * la fila), aplicaciones, rutinas, citas, recordatorios, preferencias y
 * sesiones.
 *
 * Que se conserva y por que:
 *   - El renglon de `usuaria`, anonimizado. Sin el, los cobros ya emitidos
 *     quedarian huerfanos y la contabilidad no cuadraria.
 *   - Los montos y fechas de `cobro`, por obligacion fiscal.
 *   - El `proveedor`, que es compartido: borrarlo le quitaria su veterinaria a
 *     las demas usuarias.
 *   - El contenido de `interaccion` se borra, pero no la fila: el negocio tiene
 *     derecho a que quede constancia de que se le contacto, sin los datos
 *     personales de quien.
 */
export async function borrarDatosDeUsuaria(
  pool: pg.Pool,
  usuariaId: string,
  opciones: { almacen?: Almacen } = {},
): Promise<ResultadoBorrado> {
  const { rows: documentos } = await pool.query<{ ruta_archivo: string }>(
    `SELECT ruta_archivo FROM documento WHERE usuaria_id = $1`,
    [usuariaId],
  );

  // Los archivos se borran antes que las filas: si algo falla a media
  // operacion, es preferible una fila sin archivo que un archivo sin fila, que
  // nadie volveria a encontrar para borrarlo.
  if (opciones.almacen) {
    for (const d of documentos) {
      await opciones.almacen.borrar(d.ruta_archivo).catch(() => {});
    }
  }

  return enTransaccion(pool, async (cliente) => {
    const { rows: citas } = await cliente.query<{ cuantas: number }>(
      `SELECT count(*)::int AS cuantas FROM cita WHERE usuaria_id = $1`,
      [usuariaId],
    );
    const { rows: mascotas } = await cliente.query<{ cuantas: number }>(
      `SELECT count(*)::int AS cuantas FROM mascota WHERE usuaria_id = $1`,
      [usuariaId],
    );

    await cliente.query(
      `UPDATE interaccion SET contenido = NULL, usuaria_id = NULL
        WHERE usuaria_id = $1 OR cita_id IN (SELECT id FROM cita WHERE usuaria_id = $1)`,
      [usuariaId],
    );

    // El resto cae por ON DELETE CASCADE desde mascota y cita.
    await cliente.query(`DELETE FROM documento WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(`DELETE FROM recordatorio WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(`DELETE FROM alerta_refuerzo WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(`DELETE FROM cita WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(`DELETE FROM rutina WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(`DELETE FROM mascota WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(`DELETE FROM preferencia_agenda WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(`DELETE FROM usuaria_proveedor WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(`DELETE FROM caso_excepcion WHERE usuaria_id = $1`, [usuariaId]);
    await cliente.query(`UPDATE sesion SET revocada_en = now() WHERE usuaria_id = $1`, [usuariaId]);

    // El celular se sustituye por uno irrepetible y sin relacion con el real:
    // dejarlo en NULL chocaria con el NOT NULL, y dejar un hash permitiria
    // volver a identificarla comparando.
    await cliente.query(
      `UPDATE usuaria
          SET celular = $2, nombre = NULL, celular_verificado_en = NULL,
              anonimizada_en = now(), estado = 'cancelada'
        WHERE id = $1`,
      [usuariaId, `borrado:${randomBytes(12).toString('hex')}`],
    );

    return {
      documentosBorrados: documentos.length,
      mascotasBorradas: mascotas[0]?.cuantas ?? 0,
      citasBorradas: citas[0]?.cuantas ?? 0,
    };
  });
}

/** Registra un consentimiento (aviso de privacidad, representacion, grabacion). */
export async function registrarConsentimiento(
  pool: pg.Pool,
  usuariaId: string,
  datos: { tipo: 'aviso_privacidad' | 'representacion' | 'grabacion_llamadas'; version: string; evidencia?: unknown },
): Promise<void> {
  await pool.query(
    `INSERT INTO consentimiento (usuaria_id, tipo, version, evidencia) VALUES ($1,$2,$3,$4)`,
    [usuariaId, datos.tipo, datos.version, JSON.stringify(datos.evidencia ?? {})],
  );
}

/**
 * ¿La usuaria autorizo que el sistema la represente ante el proveedor?
 *
 * Se consulta ANTES de cualquier contacto: sin ese consentimiento el agente no
 * puede dar su nombre ni el de su mascota a un tercero (seccion 09).
 */
export async function tieneConsentimientoDeRepresentacion(
  pool: pg.Pool,
  usuariaId: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ cuantos: number }>(
    `SELECT count(*)::int AS cuantos FROM consentimiento
      WHERE usuaria_id = $1 AND tipo = 'representacion' AND revocado_en IS NULL`,
    [usuariaId],
  );
  return (rows[0]?.cuantos ?? 0) > 0;
}
