/**
 * Alta y contacto de proveedores.
 *
 * Aqui vive la segunda mitad de la pregunta abierta 4: no saturar al negocio.
 *
 * Es un riesgo real y no teorico. Una estetica popular puede ser la de treinta
 * usuarias; si el sistema le manda treinta WhatsApps sueltos al mes, deja de
 * contestar, y el producto entero depende de que conteste. El limite de
 * contacto de este modulo es lo que evita que el crecimiento de Huella rompa su
 * propia relacion con los proveedores.
 */
import type pg from 'pg';
import type { Ejecutor } from '../../db/pool.js';
import { normalizarTelefonoOpcional } from '../../lib/telefono.js';
import { type DatosProveedor, claveDedup, requiereRevision } from './dedup.js';

export interface AltaProveedor extends DatosProveedor {
  direccion?: string | null;
  canalPreferido?: 'whatsapp' | 'telefono' | 'integracion';
  latitud?: number | null;
  longitud?: number | null;
}

export interface ProveedorRegistrado {
  id: string;
  yaExistia: boolean;
  requiereRevision: boolean;
}

/**
 * Registra el proveedor de una usuaria (RF-04).
 *
 * Si el negocio ya existe -- porque otra usuaria lo registro antes -- se reusa
 * la fila y solo se crea el vinculo. Esa es la decision de la seccion 11 que
 * hace que el catalogo del directorio de Fase 4 nazca solo.
 *
 * Los datos que faltaban se completan, pero los que ya estaban NO se
 * sobrescriben: la segunda usuaria no debe poder cambiarle la direccion al
 * proveedor de la primera por una errata.
 */
export async function registrarProveedorDeUsuaria(
  ejecutor: Ejecutor,
  usuariaId: string,
  datos: AltaProveedor,
  opciones: { alias?: string | null; notas?: string | null } = {},
): Promise<ProveedorRegistrado> {
  const clave = claveDedup(datos);
  const telefono = normalizarTelefonoOpcional(datos.telefono);
  const whatsapp = normalizarTelefonoOpcional(datos.whatsapp);

  const { rows } = await ejecutor.query<{ id: string; ya_existia: boolean }>(
    `INSERT INTO proveedor (negocio, sucursal, direccion, telefono, whatsapp,
                            canal_preferido, latitud, longitud, clave_dedup)
     VALUES ($1,$2,$3,$4,$5,$6::canal_contacto,$7,$8,$9)
     ON CONFLICT (clave_dedup) DO UPDATE
        SET direccion = COALESCE(proveedor.direccion, EXCLUDED.direccion),
            telefono  = COALESCE(proveedor.telefono,  EXCLUDED.telefono),
            whatsapp  = COALESCE(proveedor.whatsapp,  EXCLUDED.whatsapp),
            sucursal  = COALESCE(proveedor.sucursal,  EXCLUDED.sucursal),
            latitud   = COALESCE(proveedor.latitud,   EXCLUDED.latitud),
            longitud  = COALESCE(proveedor.longitud,  EXCLUDED.longitud),
            actualizado_en = now()
     RETURNING id, (xmax <> 0) AS ya_existia`,
    [
      datos.negocio.trim(),
      datos.sucursal?.trim() ?? null,
      datos.direccion?.trim() ?? null,
      telefono,
      whatsapp,
      datos.canalPreferido ?? (whatsapp ? 'whatsapp' : 'telefono'),
      datos.latitud ?? null,
      datos.longitud ?? null,
      clave,
    ],
  );

  const proveedor = rows[0]!;

  await ejecutor.query(
    `INSERT INTO usuaria_proveedor (usuaria_id, proveedor_id, alias, notas)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (usuaria_id, proveedor_id) DO UPDATE
        SET alias = COALESCE(EXCLUDED.alias, usuaria_proveedor.alias),
            notas = COALESCE(EXCLUDED.notas, usuaria_proveedor.notas)`,
    [usuariaId, proveedor.id, opciones.alias ?? null, opciones.notas ?? null],
  );

  return {
    id: proveedor.id,
    yaExistia: proveedor.ya_existia,
    requiereRevision: requiereRevision(datos),
  };
}

// ---------------------------------------------------------------------------
// Limite de contacto
// ---------------------------------------------------------------------------

/**
 * Cuantas veces como maximo se contacta a un mismo negocio en una ventana.
 *
 * Seis en dos horas permite atender una racha de citas sin parecer un robot que
 * marca sin parar. Los numeros son deliberadamente conservadores: es mas barato
 * que una cita tarde media hora mas en cerrarse que perder al proveedor.
 */
export const LIMITE_CONTACTOS = 6;
export const VENTANA_HORAS = 2;

export interface PermisoContacto {
  permitido: boolean;
  contactosEnVentana: number;
  /** Cuando se podra volver a contactar, si ahora no se puede. */
  reintentarDespuesDe: Date | null;
}

/**
 * ¿Se le puede escribir o llamar ahora a este proveedor?
 *
 * Se cuenta sobre `interaccion`, que ya es la bitacora de todo contacto
 * saliente (seccion 05 y RNF-09): no hace falta un contador aparte que se
 * pueda desincronizar.
 */
export async function puedeContactarse(
  ejecutor: Ejecutor,
  proveedorId: string,
  opciones: { ahora?: Date; limite?: number; ventanaHoras?: number } = {},
): Promise<PermisoContacto> {
  const ahora = opciones.ahora ?? new Date();
  const limite = opciones.limite ?? LIMITE_CONTACTOS;
  const ventanaHoras = opciones.ventanaHoras ?? VENTANA_HORAS;
  const desde = new Date(ahora.getTime() - ventanaHoras * 60 * 60 * 1000);

  const { rows } = await ejecutor.query<{ cuantos: number; mas_antiguo: Date | null }>(
    `SELECT count(*)::int AS cuantos, min(ocurrio_en) AS mas_antiguo
       FROM interaccion
      WHERE proveedor_id = $1 AND direccion = 'saliente' AND ocurrio_en >= $2`,
    [proveedorId, desde],
  );

  const { cuantos, mas_antiguo } = rows[0]!;
  if (cuantos < limite) {
    return { permitido: true, contactosEnVentana: cuantos, reintentarDespuesDe: null };
  }

  // Se podra volver a contactar cuando el mas antiguo salga de la ventana.
  const reintentar = mas_antiguo
    ? new Date(mas_antiguo.getTime() + ventanaHoras * 60 * 60 * 1000)
    : new Date(ahora.getTime() + ventanaHoras * 60 * 60 * 1000);

  return { permitido: false, contactosEnVentana: cuantos, reintentarDespuesDe: reintentar };
}

/**
 * Registra un contacto con el proveedor y su evidencia.
 *
 * Seccion 05: "Toda cita queda con evidencia: transcripcion de la llamada o
 * captura del hilo de WhatsApp, guardada junto a la cita."
 */
export async function registrarInteraccion(
  ejecutor: Ejecutor,
  datos: {
    citaId?: string | null;
    proveedorId?: string | null;
    usuariaId?: string | null;
    canal: 'whatsapp' | 'llamada' | 'integracion' | 'manual';
    direccion: 'saliente' | 'entrante';
    contenido?: string | null;
    resultado?: string | null;
    actor?: string;
    ocurrioEn?: Date;
  },
): Promise<string> {
  const { rows } = await ejecutor.query<{ id: string }>(
    `INSERT INTO interaccion (cita_id, proveedor_id, usuaria_id, canal, direccion,
                              contenido, resultado, actor, ocurrio_en)
     VALUES ($1,$2,$3,$4,$5::direccion_interaccion,$6,$7,$8,COALESCE($9, now()))
     RETURNING id`,
    [
      datos.citaId ?? null,
      datos.proveedorId ?? null,
      datos.usuariaId ?? null,
      datos.canal,
      datos.direccion,
      datos.contenido ?? null,
      datos.resultado ?? null,
      datos.actor ?? 'agente',
      datos.ocurrioEn ?? null,
    ],
  );
  return rows[0]!.id;
}

/** Proveedores que comparten varias usuarias: la semilla del directorio (Fase 4). */
export async function proveedoresCompartidos(
  pool: pg.Pool,
  opciones: { minimoUsuarias?: number } = {},
): Promise<Array<{ id: string; negocio: string; sucursal: string | null; usuarias: number; citas: number }>> {
  const { rows } = await pool.query(
    `SELECT p.id, p.negocio, p.sucursal,
            count(DISTINCT up.usuaria_id)::int AS usuarias,
            (SELECT count(*)::int FROM cita c WHERE c.proveedor_id = p.id) AS citas
       FROM proveedor p
       JOIN usuaria_proveedor up ON up.proveedor_id = p.id
      GROUP BY p.id
     HAVING count(DISTINCT up.usuaria_id) >= $1
      ORDER BY usuarias DESC, citas DESC`,
    [opciones.minimoUsuarias ?? 2],
  );
  return rows as Array<{ id: string; negocio: string; sucursal: string | null; usuarias: number; citas: number }>;
}
