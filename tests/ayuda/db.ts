/**
 * Utilidades para las pruebas de integracion.
 *
 * Corren contra un Postgres de verdad, no contra un doble. Lo que se prueba
 * aqui -- bloqueos de fila, indices unicos, transacciones, el calculo de
 * retraso -- solo existe en la base: un repositorio simulado daria verde
 * mientras produccion falla.
 */
import pg from 'pg';
import { crearPool } from '../../src/db/pool.js';
import { migrar } from '../../src/db/migrate.js';
import { instanteDesdeLocal } from '../../src/domain/tiempo.js';

export const URL_PRUEBAS =
  process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5432/huella_test';

export const CDMX = 'America/Mexico_City';

let migrado = false;

export async function prepararBase(): Promise<pg.Pool> {
  if (!migrado) {
    await migrar(URL_PRUEBAS, { silencioso: true });
    migrado = true;
  }
  return crearPool(URL_PRUEBAS);
}

/** Vacia los datos entre pruebas, conservando el catalogo de servicios. */
export async function limpiar(pool: pg.Pool): Promise<void> {
  await pool.query(`
    TRUNCATE usuaria, proveedor, usuario_interno, bitacora_acceso, bitacora_agente
    RESTART IDENTITY CASCADE
  `);
}

// ---------------------------------------------------------------------------
// Fabricas
// ---------------------------------------------------------------------------

export interface UsuariaCreada {
  id: string;
  celular: string;
}

export async function crearUsuaria(
  pool: pg.Pool,
  datos: { celular?: string; nombre?: string; zona?: string; horaAvisoDia?: string } = {},
): Promise<UsuariaCreada> {
  const celular = datos.celular ?? `+52155${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO usuaria (celular, celular_verificado_en, nombre, zona_horaria, hora_aviso_dia, estado)
     VALUES ($1, now(), $2, $3, $4, 'activa') RETURNING id`,
    [celular, datos.nombre ?? 'Ana', datos.zona ?? CDMX, datos.horaAvisoDia ?? '08:00'],
  );
  return { id: rows[0]!.id, celular };
}

export async function crearMascota(
  pool: pg.Pool,
  usuariaId: string,
  datos: { nombre?: string; especie?: string } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO mascota (usuaria_id, nombre, especie) VALUES ($1, $2, $3::especie) RETURNING id`,
    [usuariaId, datos.nombre ?? 'Lola', datos.especie ?? 'perro'],
  );
  return rows[0]!.id;
}

export async function crearProveedor(
  pool: pg.Pool,
  datos: { negocio?: string; sucursal?: string; direccion?: string; claveDedup?: string } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO proveedor (negocio, sucursal, direccion, clave_dedup)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      datos.negocio ?? 'Petco',
      datos.sucursal ?? 'Polanco',
      datos.direccion ?? 'Av. Presidente Masaryk 275',
      datos.claveDedup ?? `dedup-${Math.random().toString(36).slice(2)}`,
    ],
  );
  return rows[0]!.id;
}

export async function ligarProveedor(pool: pg.Pool, usuariaId: string, proveedorId: string): Promise<void> {
  await pool.query(
    `INSERT INTO usuaria_proveedor (usuaria_id, proveedor_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [usuariaId, proveedorId],
  );
}

export async function crearRutina(
  pool: pg.Pool,
  datos: {
    usuariaId: string;
    mascotaId: string;
    proveedorId: string;
    tipoServicio?: string;
    cantidad?: number;
    unidad?: 'semanas' | 'meses';
    proximaFecha: string;
    costoReferencia?: number | null;
    diasAnticipacion?: number;
    horaPreferida?: string;
  },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO rutina (usuaria_id, mascota_id, proveedor_id, tipo_servicio,
                         frecuencia_cantidad, frecuencia_unidad, costo_referencia,
                         dias_anticipacion, hora_preferida, proxima_fecha_estimada)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      datos.usuariaId,
      datos.mascotaId,
      datos.proveedorId,
      datos.tipoServicio ?? 'bano',
      datos.cantidad ?? 1,
      datos.unidad ?? 'meses',
      datos.costoReferencia ?? 450,
      datos.diasAnticipacion ?? 21,
      datos.horaPreferida ?? '11:00',
      datos.proximaFecha,
    ],
  );
  return rows[0]!.id;
}

export async function crearCita(
  pool: pg.Pool,
  datos: {
    usuariaId: string;
    mascotaId: string;
    proveedorId: string;
    rutinaId?: string | null;
    tipoServicio?: string;
    estado?: string;
    iniciaEn: Date;
    costoConfirmado?: number | null;
    indicaciones?: string | null;
  },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, rutina_id, tipo_servicio,
                       estado, inicia_en, costo_confirmado, indicaciones)
     VALUES ($1,$2,$3,$4,$5,$6::estado_cita,$7,$8,$9) RETURNING id`,
    [
      datos.usuariaId,
      datos.mascotaId,
      datos.proveedorId,
      datos.rutinaId ?? null,
      datos.tipoServicio ?? 'bano',
      datos.estado ?? 'confirmada',
      datos.iniciaEn,
      // Ojo con `??`: un costo nulo es "costo por confirmar" y hay que
      // conservarlo, no sustituirlo por el de referencia.
      datos.costoConfirmado === undefined ? 450 : datos.costoConfirmado,
      datos.indicaciones ?? null,
    ],
  );
  return rows[0]!.id;
}

/** Escenario completo: usuaria, mascota, proveedor ligado y una cita confirmada. */
export async function escenarioBasico(
  pool: pg.Pool,
  opciones: { fechaCita?: string; horaCita?: string; zona?: string; costo?: number | null } = {},
) {
  const zona = opciones.zona ?? CDMX;
  const usuaria = await crearUsuaria(pool, { zona });
  const mascotaId = await crearMascota(pool, usuaria.id);
  const proveedorId = await crearProveedor(pool);
  await ligarProveedor(pool, usuaria.id, proveedorId);
  const iniciaEn = instanteDesdeLocal(opciones.fechaCita ?? '2026-10-22', opciones.horaCita ?? '11:00', zona);
  const citaId = await crearCita(pool, {
    usuariaId: usuaria.id,
    mascotaId,
    proveedorId,
    iniciaEn,
    costoConfirmado: opciones.costo === undefined ? 450 : opciones.costo,
  });
  return { usuaria, mascotaId, proveedorId, citaId, iniciaEn, zona };
}

export async function recordatoriosDe(pool: pg.Pool, citaId: string) {
  const { rows } = await pool.query(
    `SELECT momento, estado, programado_para, enviado_en, intentos, retraso_segundos,
            contenido_enviado, plantilla, ultimo_error, proximo_intento_en, id_externo
       FROM recordatorio WHERE cita_id = $1 ORDER BY programado_para`,
    [citaId],
  );
  return rows as Array<{
    momento: string;
    estado: string;
    programado_para: Date;
    enviado_en: Date | null;
    intentos: number;
    retraso_segundos: number | null;
    contenido_enviado: string | null;
    plantilla: string | null;
    ultimo_error: string | null;
    proximo_intento_en: Date | null;
    id_externo: string | null;
  }>;
}

export async function casosAbiertos(pool: pg.Pool) {
  const { rows } = await pool.query(
    `SELECT motivo, detalle, estado, abierto_en FROM caso_excepcion ORDER BY abierto_en`,
  );
  return rows as Array<{ motivo: string; detalle: string; estado: string; abierto_en: Date }>;
}

/** Reloj fijo, para poder situarse en cualquier momento del ciclo. */
export function relojEn(instante: Date) {
  let actual = instante;
  return {
    ahora: () => actual,
    mover: (nuevo: Date) => {
      actual = nuevo;
    },
    avanzarMinutos: (minutos: number) => {
      actual = new Date(actual.getTime() + minutos * 60_000);
    },
  };
}
