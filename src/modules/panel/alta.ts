/**
 * Alta de una clienta desde el panel, con su mascota y su rutina de un jalón.
 *
 * El alta normal (RF-01) la hace la propia usuaria por WhatsApp con un código.
 * Ésta es la del piloto: la operadora está al teléfono con la clienta y captura
 * todo mientras hablan. Por eso es una sola transacción — si algo falla a media
 * captura, no queda una clienta sin mascota ni una mascota sin rutina.
 *
 * Dos cosas que NO se saltan por ser alta manual:
 *
 *   - El consentimiento del aviso de privacidad se registra igual, con la
 *     versión, la fecha y quién lo capturó (sección 09). Que lo haya aceptado
 *     de viva voz no exime de dejar constancia de cuál aceptó.
 *   - El celular se guarda sin verificar. La clienta lo verifica la primera vez
 *     que contesta por WhatsApp; hasta entonces `celular_verificado_en` queda en
 *     nulo y eso es visible en el panel.
 */
import type pg from 'pg';
import { enTransaccion } from '../../db/pool.js';
import { normalizarTelefono } from '../../lib/telefono.js';
import { sumarFrecuencia, validarZonaHoraria } from '../../domain/tiempo.js';
import { registrarProveedorDeUsuaria } from '../proveedores/servicio.js';
import { iniciarSuscripcion, type Pasarela } from '../suscripcion/servicio.js';
import { type EstadoDeInvitacion, estadoDeInvitacion } from '../alta/invitaciones.js';

export interface DatosAltaClienta {
  clienta: {
    nombre: string;
    celular: string;
    zonaHoraria?: string;
    horaAvisoDia?: string;
    /**
     * `no_acepto` registra a quien se le ofreció el producto y dijo que no.
     * Sin este registro la tasa de aceptación no significa nada: dividiría a
     * las que aceptaron entre ellas mismas.
     */
    estado?: 'prueba' | 'no_acepto';
  };
  mascota: {
    nombre: string;
    especie: 'perro' | 'gato' | 'otra';
    raza?: string | null;
    pesoKg?: number | null;
    sexo?: 'macho' | 'hembra' | 'desconocido';
    notasManejo?: string | null;
  };
  proveedor: {
    negocio: string;
    sucursal?: string | null;
    direccion?: string | null;
    telefono?: string | null;
    whatsapp?: string | null;
  };
  rutina: {
    tipoServicio: string;
    frecuenciaCantidad: number;
    frecuenciaUnidad: 'semanas' | 'meses';
    costoReferencia?: number | null;
    horaPreferida?: string;
    proximaFechaEstimada?: string;
  };
  /** Franjas viables, con prioridad (RF-03). Alimentan las opciones de T−21. */
  preferencias?: Array<{ diaSemana: number; horaInicio: string; horaFin: string; prioridad: number }>;
}

export interface ResultadoAlta {
  usuariaId: string;
  mascotaId: string;
  proveedorId: string;
  rutinaId: string;
  proximaFechaEstimada: string;
  /** Verdadero si el negocio ya estaba en el catálogo de otra clienta. */
  proveedorYaExistia: boolean;
  estado: 'prueba' | 'no_acepto';
}

export class CelularYaRegistrado extends Error {
  constructor(celular: string) {
    super(`Ya hay una clienta con el celular ${celular}.`);
    this.name = 'CelularYaRegistrado';
  }
}

export async function altaDeClienta(
  pool: pg.Pool,
  datos: DatosAltaClienta,
  opciones: {
    versionAvisoPrivacidad: string;
    operadorId: string;
    pasarela: Pasarela;
    diasPrueba: number;
    precioMensual: number;
    ahora?: Date;
  },
): Promise<ResultadoAlta> {
  const celular = normalizarTelefono(datos.clienta.celular);
  const zona = datos.clienta.zonaHoraria ?? 'America/Mexico_City';
  validarZonaHoraria(zona);

  const hoy = (opciones.ahora ?? new Date()).toISOString().slice(0, 10);
  const proximaFecha =
    datos.rutina.proximaFechaEstimada ??
    sumarFrecuencia(hoy, datos.rutina.frecuenciaCantidad, datos.rutina.frecuenciaUnidad);

  const estadoInicial = datos.clienta.estado ?? 'prueba';

  const resultado = await enTransaccion(pool, async (cliente) => {
    const { rows: existentes } = await cliente.query(
      `SELECT 1 FROM usuaria WHERE celular = $1 AND anonimizada_en IS NULL`,
      [celular],
    );
    if (existentes.length > 0) throw new CelularYaRegistrado(celular);

    const { rows: usuarias } = await cliente.query<{ id: string }>(
      `INSERT INTO usuaria (celular, nombre, zona_horaria, hora_aviso_dia, estado)
       VALUES ($1,$2,$3,COALESCE($4::time, '08:00'),$5::estado_suscripcion)
       RETURNING id`,
      [celular, datos.clienta.nombre.trim(), zona, datos.clienta.horaAvisoDia ?? null, estadoInicial],
    );
    const usuariaId = usuarias[0]!.id;

    await cliente.query(
      `INSERT INTO consentimiento (usuaria_id, tipo, version, evidencia)
       VALUES ($1, 'aviso_privacidad', $2, $3)`,
      [
        usuariaId,
        opciones.versionAvisoPrivacidad,
        JSON.stringify({ medio: 'panel_interno', capturado_por: opciones.operadorId }),
      ],
    );

    for (const p of datos.preferencias ?? []) {
      await cliente.query(
        `INSERT INTO preferencia_agenda (usuaria_id, dia_semana, hora_inicio, hora_fin, prioridad)
         VALUES ($1,$2,$3,$4,$5)`,
        [usuariaId, p.diaSemana, p.horaInicio, p.horaFin, p.prioridad],
      );
    }

    const { rows: mascotas } = await cliente.query<{ id: string }>(
      `INSERT INTO mascota (usuaria_id, nombre, especie, raza, peso_kg, sexo, notas_manejo)
       VALUES ($1,$2,$3::especie,$4,$5,$6::sexo_mascota,$7)
       RETURNING id`,
      [
        usuariaId,
        datos.mascota.nombre.trim(),
        datos.mascota.especie,
        datos.mascota.raza?.trim() || null,
        datos.mascota.pesoKg ?? null,
        datos.mascota.sexo ?? 'desconocido',
        datos.mascota.notasManejo?.trim() || null,
      ],
    );
    const mascotaId = mascotas[0]!.id;

    // Reusa el negocio si otra clienta ya lo registró (sección 11).
    const proveedor = await registrarProveedorDeUsuaria(cliente, usuariaId, datos.proveedor);

    const { rows: rutinas } = await cliente.query<{ id: string }>(
      `INSERT INTO rutina (usuaria_id, mascota_id, proveedor_id, tipo_servicio,
                           frecuencia_cantidad, frecuencia_unidad, costo_referencia,
                           hora_preferida, proxima_fecha_estimada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::time,'10:00'),$9)
       RETURNING id`,
      [
        usuariaId,
        mascotaId,
        proveedor.id,
        datos.rutina.tipoServicio,
        datos.rutina.frecuenciaCantidad,
        datos.rutina.frecuenciaUnidad,
        datos.rutina.costoReferencia ?? null,
        datos.rutina.horaPreferida ?? null,
        proximaFecha,
      ],
    );

    return {
      usuariaId,
      mascotaId,
      proveedorId: proveedor.id,
      rutinaId: rutinas[0]!.id,
      proximaFechaEstimada: proximaFecha,
      proveedorYaExistia: proveedor.yaExistia,
    };
  });

  // A quien dijo que no no se le abre periodo de prueba: queda registrada para
  // que la tasa de aceptación la cuente, y nada más.
  if (estadoInicial !== 'no_acepto') {
    // La suscripción va fuera de la transacción porque habla con la pasarela, y
    // una llamada de red no debe tener abierta una transacción de base de datos.
    // Si falla, la clienta ya quedó dada de alta y el periodo de prueba se puede
    // iniciar después desde el panel.
    await iniciarSuscripcion(pool, resultado.usuariaId, {
      diasPrueba: opciones.diasPrueba,
      precioMensual: opciones.precioMensual,
      pasarela: opciones.pasarela,
      ...(opciones.ahora ? { ahora: opciones.ahora } : {}),
    });
  }

  return { ...resultado, estado: estadoInicial };
}

export interface ClientaEnLista {
  id: string;
  nombre: string | null;
  celular: string;
  celularVerificado: boolean;
  estado: string;
  zonaHoraria: string;
  mascotas: string[];
  rutinasActivas: number;
  proximaFecha: string | null;
  creadaEn: Date;
  /** Si ya se le mandó el enlace de alta, si lo abrió y si lo terminó. */
  invitacion: EstadoDeInvitacion;
}

export async function listarClientas(pool: pg.Pool): Promise<ClientaEnLista[]> {
  const { rows } = await pool.query(
    `SELECT u.id, u.nombre, u.celular, u.zona_horaria, u.estado, u.creada_en,
            u.celular_verificado_en IS NOT NULL AS celular_verificado,
            COALESCE(
              (SELECT array_agg(m.nombre ORDER BY m.creada_en)
                 FROM mascota m WHERE m.usuaria_id = u.id AND m.archivada_en IS NULL),
              '{}') AS mascotas,
            (SELECT count(*)::int FROM rutina r WHERE r.usuaria_id = u.id AND r.activa) AS rutinas_activas,
            (SELECT min(r.proxima_fecha_estimada)::text FROM rutina r
              WHERE r.usuaria_id = u.id AND r.activa) AS proxima_fecha
       FROM usuaria u
      WHERE u.anonimizada_en IS NULL
      ORDER BY u.creada_en DESC`,
  );

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      nombre: r.nombre,
      celular: r.celular,
      celularVerificado: r.celular_verificado,
      estado: r.estado,
      zonaHoraria: r.zona_horaria,
      mascotas: r.mascotas,
      rutinasActivas: r.rutinas_activas,
      proximaFecha: r.proxima_fecha,
      creadaEn: r.creada_en,
      invitacion: await estadoDeInvitacion(pool, r.id),
    })),
  );
}

// ---------------------------------------------------------------------------
// Detalle de una clienta
// ---------------------------------------------------------------------------

export interface DetalleDeClienta {
  clienta: {
    id: string;
    nombre: string | null;
    celular: string;
    celularVerificado: boolean;
    estado: string;
    zonaHoraria: string;
    horaAvisoDia: string;
    creadaEn: Date;
  };
  mascotas: Array<{
    id: string;
    nombre: string;
    especie: string;
    raza: string | null;
    pesoKg: number | null;
    notasManejo: string | null;
  }>;
  rutinas: Array<{
    id: string;
    mascota: string;
    servicio: string;
    proveedor: string;
    costoReferencia: number | null;
    periodicidad: string;
    proximaFechaEstimada: string;
    activa: boolean;
  }>;
  /** Las tres más recientes. Es lo que se necesita para entender el caso. */
  ultimasCitas: Array<{
    id: string;
    fecha: Date;
    estado: string;
    servicio: string;
    mascota: string;
    proveedor: string;
    costoConfirmado: number | null;
    costoReal: number | null;
  }>;
}

export class ClientaNoEncontrada extends Error {
  constructor(id: string) {
    super(`No se encontró la clienta ${id}.`);
    this.name = 'ClientaNoEncontrada';
  }
}

/** "cada mes", "cada 3 semanas". */
function textoPeriodicidad(cantidad: number, unidad: string): string {
  if (cantidad === 1) return unidad === 'meses' ? 'cada mes' : 'cada semana';
  return `cada ${cantidad} ${unidad}`;
}

export async function detalleDeClienta(pool: pg.Pool, usuariaId: string): Promise<DetalleDeClienta> {
  const { rows: clientas } = await pool.query(
    `SELECT id, nombre, celular, zona_horaria, hora_aviso_dia, estado, creada_en,
            celular_verificado_en IS NOT NULL AS celular_verificado
       FROM usuaria WHERE id = $1 AND anonimizada_en IS NULL`,
    [usuariaId],
  );
  const c = clientas[0];
  if (!c) throw new ClientaNoEncontrada(usuariaId);

  const { rows: mascotas } = await pool.query(
    `SELECT id, nombre, especie, raza, peso_kg, notas_manejo
       FROM mascota WHERE usuaria_id = $1 AND archivada_en IS NULL ORDER BY creada_en`,
    [usuariaId],
  );

  const { rows: rutinas } = await pool.query(
    `SELECT r.id, r.costo_referencia, r.frecuencia_cantidad, r.frecuencia_unidad,
            r.proxima_fecha_estimada, r.activa,
            m.nombre AS mascota, ts.nombre AS servicio,
            CASE WHEN p.sucursal IS NULL OR p.sucursal = '' THEN p.negocio
                 ELSE p.negocio || ' ' || p.sucursal END AS proveedor
       FROM rutina r
       JOIN mascota m        ON m.id = r.mascota_id
       JOIN proveedor p      ON p.id = r.proveedor_id
       JOIN tipo_servicio ts ON ts.codigo = r.tipo_servicio
      WHERE r.usuaria_id = $1
      ORDER BY r.proxima_fecha_estimada`,
    [usuariaId],
  );

  const { rows: citas } = await pool.query(
    `SELECT c.id, c.inicia_en, c.estado, c.costo_confirmado, c.costo_real,
            ts.nombre AS servicio, m.nombre AS mascota,
            CASE WHEN p.sucursal IS NULL OR p.sucursal = '' THEN p.negocio
                 ELSE p.negocio || ' ' || p.sucursal END AS proveedor
       FROM cita c
       JOIN mascota m        ON m.id = c.mascota_id
       JOIN proveedor p      ON p.id = c.proveedor_id
       JOIN tipo_servicio ts ON ts.codigo = c.tipo_servicio
      WHERE c.usuaria_id = $1
      ORDER BY c.inicia_en DESC
      LIMIT 3`,
    [usuariaId],
  );

  return {
    clienta: {
      id: c.id,
      nombre: c.nombre,
      celular: c.celular,
      celularVerificado: c.celular_verificado,
      estado: c.estado,
      zonaHoraria: c.zona_horaria,
      horaAvisoDia: c.hora_aviso_dia,
      creadaEn: c.creada_en,
    },
    mascotas: mascotas.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      especie: m.especie,
      raza: m.raza,
      pesoKg: m.peso_kg,
      notasManejo: m.notas_manejo,
    })),
    rutinas: rutinas.map((r) => ({
      id: r.id,
      mascota: r.mascota,
      servicio: r.servicio,
      proveedor: r.proveedor,
      costoReferencia: r.costo_referencia,
      periodicidad: textoPeriodicidad(r.frecuencia_cantidad, r.frecuencia_unidad),
      proximaFechaEstimada: r.proxima_fecha_estimada,
      activa: r.activa,
    })),
    ultimasCitas: citas.map((ct) => ({
      id: ct.id,
      fecha: ct.inicia_en,
      estado: ct.estado,
      servicio: ct.servicio,
      mascota: ct.mascota,
      proveedor: ct.proveedor,
      costoConfirmado: ct.costo_confirmado,
      costoReal: ct.costo_real,
    })),
  };
}
