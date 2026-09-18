/**
 * Panel interno (RF-24) con control por rol y bitacora de consultas (RNF-06).
 *
 * "Panel interno para el equipo: citas del dia, casos atrabancados en la bandeja
 *  de excepciones, historial de conversaciones con proveedores y estado de cada
 *  suscripcion."
 *
 * RNF-06 pide "acceso al panel interno con control por rol y BITACORA DE
 * CONSULTAS". Lo segundo es lo que suele faltar: casi todos los sistemas
 * registran quien modifico algo y casi ninguno registra quien LEYO el
 * expediente de una clienta. Aqui cada consulta que toca datos personales pasa
 * por `conBitacora`, que no es opcional ni se puede saltar sin que se note.
 */
import type pg from 'pg';
import type { Ejecutor } from '../../db/pool.js';

export type RolInterno = 'operadora' | 'supervisora' | 'administradora';

export interface Operador {
  id: string;
  nombre: string;
  rol: RolInterno;
}

export type Permiso =
  | 'alta_clienta'
  | 'ver_bandeja'
  | 'resolver_caso'
  | 'ver_expediente'
  | 'ver_conversaciones'
  | 'ver_suscripciones'
  | 'exportar_datos'
  | 'borrar_datos'
  | 'administrar_equipo';

const PERMISOS: Record<RolInterno, readonly Permiso[]> = {
  // La operadora hace el trabajo diario: da de alta clientas, atiende la bandeja
  // y resuelve citas.
  operadora: ['alta_clienta', 'ver_bandeja', 'resolver_caso', 'ver_expediente', 'ver_conversaciones'],
  // La supervisora ademas ve el estado comercial.
  supervisora: [
    'alta_clienta',
    'ver_bandeja',
    'resolver_caso',
    'ver_expediente',
    'ver_conversaciones',
    'ver_suscripciones',
    'exportar_datos',
  ],
  // Borrar los datos de una usuaria es irreversible: un solo rol puede hacerlo.
  administradora: [
    'alta_clienta',
    'ver_bandeja',
    'resolver_caso',
    'ver_expediente',
    'ver_conversaciones',
    'ver_suscripciones',
    'exportar_datos',
    'borrar_datos',
    'administrar_equipo',
  ],
};

export class SinPermiso extends Error {
  constructor(rol: RolInterno, permiso: Permiso) {
    super(`El rol "${rol}" no puede "${permiso}".`);
    this.name = 'SinPermiso';
  }
}

export function puede(rol: RolInterno, permiso: Permiso): boolean {
  return PERMISOS[rol].includes(permiso);
}

export function asegurarPermiso(operador: Operador, permiso: Permiso): void {
  if (!puede(operador.rol, permiso)) throw new SinPermiso(operador.rol, permiso);
}

export async function registrarEnBitacora(
  ejecutor: Ejecutor,
  datos: {
    operadorId: string | null;
    accion: 'consulta' | 'modificacion' | 'exportacion' | 'borrado';
    entidad: string;
    entidadId?: string | null;
    usuariaAfectadaId?: string | null;
    detalle?: Record<string, unknown>;
  },
): Promise<void> {
  await ejecutor.query(
    `INSERT INTO bitacora_acceso (usuario_interno_id, accion, entidad, entidad_id, usuaria_afectada_id, detalle)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      datos.operadorId,
      datos.accion,
      datos.entidad,
      datos.entidadId ?? null,
      datos.usuariaAfectadaId ?? null,
      JSON.stringify(datos.detalle ?? {}),
    ],
  );
}

/**
 * Comprueba el permiso, corre la consulta y la registra en la bitacora.
 *
 * Todo acceso del panel a datos personales pasa por aqui. Que la bitacora se
 * escriba dentro de esta funcion y no en cada llamada es lo que hace que no se
 * pueda olvidar.
 */
export async function conBitacora<T>(
  pool: pg.Pool,
  operador: Operador,
  permiso: Permiso,
  registro: {
    accion: 'consulta' | 'modificacion' | 'exportacion' | 'borrado';
    entidad: string;
    entidadId?: string | null;
    usuariaAfectadaId?: string | null;
    detalle?: Record<string, unknown>;
  },
  consulta: () => Promise<T>,
): Promise<T> {
  asegurarPermiso(operador, permiso);
  const resultado = await consulta();
  await registrarEnBitacora(pool, { operadorId: operador.id, ...registro });
  return resultado;
}

// ---------------------------------------------------------------------------
// Vistas del panel
// ---------------------------------------------------------------------------

export interface CitaDelDia {
  id: string;
  iniciaEn: Date;
  estado: string;
  servicio: string;
  mascota: string;
  usuaria: string | null;
  celular: string;
  proveedor: string;
  costoConfirmado: number | null;
  tieneEvidencia: boolean;
}

/** Citas de un dia, en la zona horaria de cada usuaria. */
export async function citasDelDia(
  pool: pg.Pool,
  operador: Operador,
  fecha: string,
): Promise<CitaDelDia[]> {
  return conBitacora(
    pool,
    operador,
    'ver_expediente',
    { accion: 'consulta', entidad: 'cita', detalle: { fecha } },
    async () => {
      const { rows } = await pool.query(
        `SELECT c.id, c.inicia_en, c.estado, c.costo_confirmado,
                ts.nombre AS servicio, m.nombre AS mascota,
                u.nombre AS usuaria, u.celular,
                CASE WHEN p.sucursal IS NULL OR p.sucursal = '' THEN p.negocio
                     ELSE p.negocio || ' ' || p.sucursal END AS proveedor,
                EXISTS (SELECT 1 FROM interaccion i WHERE i.cita_id = c.id) AS tiene_evidencia
           FROM cita c
           JOIN usuaria u        ON u.id = c.usuaria_id
           JOIN mascota m        ON m.id = c.mascota_id
           JOIN proveedor p      ON p.id = c.proveedor_id
           JOIN tipo_servicio ts ON ts.codigo = c.tipo_servicio
          WHERE (c.inicia_en AT TIME ZONE u.zona_horaria)::date = $1::date
            AND u.anonimizada_en IS NULL
          ORDER BY c.inicia_en`,
        [fecha],
      );
      return rows.map((r) => ({
        id: r.id,
        iniciaEn: r.inicia_en,
        estado: r.estado,
        servicio: r.servicio,
        mascota: r.mascota,
        usuaria: r.usuaria,
        celular: r.celular,
        proveedor: r.proveedor,
        costoConfirmado: r.costo_confirmado,
        tieneEvidencia: r.tiene_evidencia,
      })) as CitaDelDia[];
    },
  );
}

/**
 * Citas próximas para la pestaña de Citas.
 *
 * Mira un poco hacia atrás además de hacia adelante: una cita de anteayer que
 * todavía no se cierra es justo la que la operadora tiene que atender, y
 * esconderla por haber pasado sería perderla.
 */
export async function citasProximas(
  pool: pg.Pool,
  operador: Operador,
  opciones: { diasAtras?: number; diasAdelante?: number } = {},
): Promise<CitaDelDia[]> {
  return conBitacora(
    pool,
    operador,
    'ver_expediente',
    { accion: 'consulta', entidad: 'cita' },
    async () => {
      const { rows } = await pool.query(
        `SELECT c.id, c.inicia_en, c.estado, c.costo_confirmado, c.costo_real,
                ts.nombre AS servicio, m.nombre AS mascota,
                u.nombre AS usuaria, u.celular,
                CASE WHEN p.sucursal IS NULL OR p.sucursal = '' THEN p.negocio
                     ELSE p.negocio || ' ' || p.sucursal END AS proveedor,
                p.telefono AS proveedor_telefono,
                p.whatsapp AS proveedor_whatsapp,
                p.direccion AS proveedor_direccion,
                m.raza, m.peso_kg,
                u.zona_horaria,
                EXISTS (SELECT 1 FROM interaccion i WHERE i.cita_id = c.id) AS tiene_evidencia,
                (SELECT count(*)::int FROM recordatorio r
                  WHERE r.cita_id = c.id AND r.estado IN ('enviado','entregado','leido')) AS avisos_enviados,
                (SELECT count(*)::int FROM recordatorio r WHERE r.cita_id = c.id) AS avisos_totales
           FROM cita c
           JOIN usuaria u        ON u.id = c.usuaria_id
           JOIN mascota m        ON m.id = c.mascota_id
           JOIN proveedor p      ON p.id = c.proveedor_id
           JOIN tipo_servicio ts ON ts.codigo = c.tipo_servicio
          WHERE u.anonimizada_en IS NULL
            AND c.estado NOT IN ('cancelada', 'reagendada')
            AND c.inicia_en >= now() - ($1 || ' days')::interval
            AND c.inicia_en <= now() + ($2 || ' days')::interval
          ORDER BY c.inicia_en`,
        [String(opciones.diasAtras ?? 14), String(opciones.diasAdelante ?? 90)],
      );
      return rows as unknown as CitaDelDia[];
    },
  );
}

export interface CasoEnBandeja {
  id: string;
  motivo: string;
  detalle: string | null;
  estado: string;
  abiertoEn: Date;
  minutosAbierto: number;
  citaId: string | null;
  usuaria: string | null;
  celular: string | null;
}

/**
 * Bandeja de excepciones (RF-10).
 *
 * Ordenada por antiguedad, no por fecha de cita: el criterio de aceptacion de la
 * seccion 12 es que un caso no resuelto aparezca en menos de una hora, asi que
 * lo que importa es cual lleva mas tiempo esperando.
 */
export async function bandejaDeExcepciones(
  pool: pg.Pool,
  operador: Operador,
  opciones: { incluirResueltos?: boolean } = {},
): Promise<CasoEnBandeja[]> {
  return conBitacora(
    pool,
    operador,
    'ver_bandeja',
    { accion: 'consulta', entidad: 'caso_excepcion' },
    async () => {
      const { rows } = await pool.query(
        `SELECT ce.id, ce.motivo, ce.detalle, ce.estado, ce.abierto_en, ce.cita_id,
                EXTRACT(EPOCH FROM (now() - ce.abierto_en))/60 AS minutos_abierto,
                u.nombre AS usuaria, u.celular
           FROM caso_excepcion ce
           LEFT JOIN usuaria u ON u.id = ce.usuaria_id
          WHERE ($1::boolean OR ce.estado IN ('abierto','en_proceso'))
          ORDER BY ce.abierto_en`,
        [opciones.incluirResueltos ?? false],
      );
      return rows.map((r) => ({
        id: r.id,
        motivo: r.motivo,
        detalle: r.detalle,
        estado: r.estado,
        abiertoEn: r.abierto_en,
        minutosAbierto: Math.round(Number(r.minutos_abierto)),
        citaId: r.cita_id,
        usuaria: r.usuaria,
        celular: r.celular,
      })) as CasoEnBandeja[];
    },
  );
}

export async function resolverCaso(
  pool: pg.Pool,
  operador: Operador,
  casoId: string,
  resolucion: string,
): Promise<void> {
  await conBitacora(
    pool,
    operador,
    'resolver_caso',
    { accion: 'modificacion', entidad: 'caso_excepcion', entidadId: casoId },
    async () => {
      await pool.query(
        `UPDATE caso_excepcion
            SET estado = 'resuelto', resuelto_en = now(), resolucion = $2, asignado_a = $3
          WHERE id = $1`,
        [casoId, resolucion, operador.id],
      );
    },
  );
}

/** Historial de conversaciones con proveedores para una cita (seccion 05). */
export async function conversacionesDeCita(
  pool: pg.Pool,
  operador: Operador,
  citaId: string,
): Promise<Array<Record<string, unknown>>> {
  return conBitacora(
    pool,
    operador,
    'ver_conversaciones',
    { accion: 'consulta', entidad: 'interaccion', entidadId: citaId },
    async () => {
      const { rows } = await pool.query(
        `SELECT i.canal, i.direccion, i.contenido, i.resultado, i.actor, i.ocurrio_en,
                p.negocio, p.sucursal
           FROM interaccion i
           LEFT JOIN proveedor p ON p.id = i.proveedor_id
          WHERE i.cita_id = $1
          ORDER BY i.ocurrio_en`,
        [citaId],
      );
      return rows as Array<Record<string, unknown>>;
    },
  );
}

/** Estado de las suscripciones (RF-24). */
export async function estadoDeSuscripciones(
  pool: pg.Pool,
  operador: Operador,
): Promise<Array<Record<string, unknown>>> {
  return conBitacora(
    pool,
    operador,
    'ver_suscripciones',
    { accion: 'consulta', entidad: 'suscripcion' },
    async () => {
      const { rows } = await pool.query(
        `SELECT u.id AS usuaria_id, u.nombre, u.celular,
                s.estado, s.prueba_termina_en, s.periodo_actual_termina_en,
                s.precio_mensual, s.cancelada_en,
                (SELECT count(*)::int FROM mascota m WHERE m.usuaria_id = u.id) AS mascotas,
                (SELECT count(*)::int FROM rutina r WHERE r.usuaria_id = u.id AND r.activa) AS rutinas_activas
           FROM usuaria u
           LEFT JOIN suscripcion s ON s.usuaria_id = u.id AND s.cancelada_en IS NULL
          WHERE u.anonimizada_en IS NULL
          ORDER BY u.creada_en DESC`,
      );
      return rows as Array<Record<string, unknown>>;
    },
  );
}

/**
 * Salud de los envios (RNF-03, RNF-04).
 *
 * Es la vista que contesta el criterio de aceptacion de la seccion 12: "ningun
 * recordatorio se envia con mas de 15 minutos de retraso en una muestra de 50
 * envios".
 */
export async function saludDeEnvios(
  pool: pg.Pool,
  operador: Operador,
  opciones: { ultimos?: number } = {},
): Promise<{
  muestra: number;
  enviados: number;
  fallidos: number;
  fueraDeTolerancia: number;
  retrasoMaximoSegundos: number;
  retrasoPromedioSegundos: number;
}> {
  return conBitacora(
    pool,
    operador,
    'ver_bandeja',
    { accion: 'consulta', entidad: 'recordatorio' },
    async () => {
      const { rows } = await pool.query(
        `WITH ultimos AS (
           SELECT estado, retraso_segundos
             FROM recordatorio
            WHERE estado IN ('enviado','entregado','leido','fallido')
            ORDER BY COALESCE(enviado_en, creado_en) DESC
            LIMIT $1
         )
         SELECT count(*)::int AS muestra,
                count(*) FILTER (WHERE estado <> 'fallido')::int AS enviados,
                count(*) FILTER (WHERE estado = 'fallido')::int AS fallidos,
                count(*) FILTER (WHERE retraso_segundos > 900)::int AS fuera_de_tolerancia,
                COALESCE(max(retraso_segundos), 0)::int AS retraso_maximo,
                COALESCE(round(avg(retraso_segundos)), 0)::int AS retraso_promedio
           FROM ultimos`,
        [opciones.ultimos ?? 50],
      );
      const r = rows[0]!;
      return {
        muestra: r.muestra,
        enviados: r.enviados,
        fallidos: r.fallidos,
        fueraDeTolerancia: r.fuera_de_tolerancia,
        retrasoMaximoSegundos: r.retraso_maximo,
        retrasoPromedioSegundos: r.retraso_promedio,
      };
    },
  );
}
