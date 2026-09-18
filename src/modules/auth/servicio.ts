/**
 * RF-01: "Alta de usuaria con numero de celular verificado por codigo."
 *
 * El celular es la identidad: es por donde llega todo el producto. Por eso el
 * alta y el acceso son el mismo flujo -- pedir codigo, verificar codigo -- y no
 * hay contrasena que recordar ni recuperar.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Ejecutor } from '../../db/pool.js';
import { normalizarTelefono } from '../../lib/telefono.js';

export const MINUTOS_VIGENCIA = 10;
export const INTENTOS_MAXIMOS = 5;
/** Cuantos codigos se pueden pedir por numero en una hora. */
export const SOLICITUDES_POR_HORA = 5;

export class DemasiadasSolicitudes extends Error {}
export class CodigoInvalido extends Error {}

function hash(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}

/**
 * Genera y guarda un codigo de seis digitos.
 *
 * Solo se guarda el hash: una copia de la base no debe permitir entrar a
 * ninguna cuenta. El codigo en claro se devuelve una vez para mandarlo.
 */
export async function solicitarCodigo(
  ejecutor: Ejecutor,
  celularCrudo: string,
  opciones: { ahora?: Date } = {},
): Promise<{ celular: string; codigo: string; expiraEn: Date }> {
  const celular = normalizarTelefono(celularCrudo);
  const ahora = opciones.ahora ?? new Date();

  const { rows: recientes } = await ejecutor.query<{ cuantos: number }>(
    `SELECT count(*)::int AS cuantos FROM codigo_verificacion
      WHERE celular = $1 AND creado_en >= $2`,
    [celular, new Date(ahora.getTime() - 60 * 60 * 1000)],
  );
  if ((recientes[0]?.cuantos ?? 0) >= SOLICITUDES_POR_HORA) {
    throw new DemasiadasSolicitudes('Se pidieron demasiados códigos para este número. Intenta más tarde.');
  }

  // randomInt del modulo crypto, no Math.random: un codigo de acceso predecible
  // es una cuenta ajena abierta.
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiraEn = new Date(ahora.getTime() + MINUTOS_VIGENCIA * 60 * 1000);

  // Los codigos anteriores del mismo numero se invalidan: solo el ultimo vale.
  await ejecutor.query(
    `UPDATE codigo_verificacion SET consumido_en = $2
      WHERE celular = $1 AND consumido_en IS NULL`,
    [celular, ahora],
  );

  await ejecutor.query(
    `INSERT INTO codigo_verificacion (celular, codigo_hash, expira_en) VALUES ($1,$2,$3)`,
    [celular, hash(codigo), expiraEn],
  );

  return { celular, codigo, expiraEn };
}

export interface UsuariaVerificada {
  usuariaId: string;
  celular: string;
  esNueva: boolean;
}

/**
 * Verifica el codigo y crea la usuaria si no existia.
 *
 * `versionAvisoPrivacidad` es obligatorio en el alta: la seccion 09 pide
 * registrar la fecha y version del aviso que acepto, y la unica forma de que
 * ese registro no se olvide es que no se pueda crear una usuaria sin el.
 */
export async function verificarCodigo(
  ejecutor: Ejecutor,
  celularCrudo: string,
  codigo: string,
  opciones: { ahora?: Date; versionAvisoPrivacidad: string; nombre?: string | null; zonaHoraria?: string },
): Promise<UsuariaVerificada> {
  const celular = normalizarTelefono(celularCrudo);
  const ahora = opciones.ahora ?? new Date();

  const { rows } = await ejecutor.query<{ id: string; codigo_hash: string; intentos: number; expira_en: Date }>(
    `SELECT id, codigo_hash, intentos, expira_en
       FROM codigo_verificacion
      WHERE celular = $1 AND consumido_en IS NULL
      ORDER BY creado_en DESC
      LIMIT 1
        FOR UPDATE`,
    [celular],
  );

  const registro = rows[0];
  if (!registro) throw new CodigoInvalido('No hay un código pendiente para este número.');
  if (registro.expira_en.getTime() < ahora.getTime()) {
    throw new CodigoInvalido('El código ya venció. Pide uno nuevo.');
  }
  if (registro.intentos >= INTENTOS_MAXIMOS) {
    throw new DemasiadasSolicitudes('Demasiados intentos fallidos. Pide un código nuevo.');
  }

  const esperado = Buffer.from(registro.codigo_hash, 'hex');
  const recibido = Buffer.from(hash(codigo.trim()), 'hex');
  // Comparacion en tiempo constante: no debe poderse adivinar el codigo
  // midiendo cuanto tarda la respuesta.
  const coincide = esperado.length === recibido.length && timingSafeEqual(esperado, recibido);

  if (!coincide) {
    await ejecutor.query(`UPDATE codigo_verificacion SET intentos = intentos + 1 WHERE id = $1`, [registro.id]);
    throw new CodigoInvalido('El código no coincide.');
  }

  await ejecutor.query(`UPDATE codigo_verificacion SET consumido_en = $2 WHERE id = $1`, [registro.id, ahora]);

  const { rows: existentes } = await ejecutor.query<{ id: string }>(
    `SELECT id FROM usuaria WHERE celular = $1 AND anonimizada_en IS NULL`,
    [celular],
  );

  if (existentes[0]) {
    await ejecutor.query(`UPDATE usuaria SET celular_verificado_en = $2 WHERE id = $1`, [existentes[0].id, ahora]);
    return { usuariaId: existentes[0].id, celular, esNueva: false };
  }

  const { rows: creadas } = await ejecutor.query<{ id: string }>(
    `INSERT INTO usuaria (celular, celular_verificado_en, nombre, zona_horaria)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [celular, ahora, opciones.nombre ?? null, opciones.zonaHoraria ?? 'America/Mexico_City'],
  );
  const usuariaId = creadas[0]!.id;

  await ejecutor.query(
    `INSERT INTO consentimiento (usuaria_id, tipo, version, aceptado_en)
     VALUES ($1, 'aviso_privacidad', $2, $3)`,
    [usuariaId, opciones.versionAvisoPrivacidad, ahora],
  );

  return { usuariaId, celular, esNueva: true };
}

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

/**
 * Token de sesion opaco y aleatorio, guardado como hash.
 *
 * No se usa un JWT a proposito: un token opaco se revoca borrando una fila,
 * que es lo que hace falta cuando alguien pide de baja sus datos (seccion 09).
 */
export async function crearSesion(
  ejecutor: Ejecutor,
  usuariaId: string,
  opciones: { diasVigencia?: number } = {},
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const dias = opciones.diasVigencia ?? 90;
  await ejecutor.query(
    `INSERT INTO sesion (usuaria_id, token_hash, expira_en)
     VALUES ($1,$2, now() + ($3 || ' days')::interval)`,
    [usuariaId, hash(token), String(dias)],
  );
  return token;
}

export async function usuariaDeSesion(ejecutor: Ejecutor, token: string): Promise<string | null> {
  const { rows } = await ejecutor.query<{ usuaria_id: string }>(
    `SELECT s.usuaria_id
       FROM sesion s JOIN usuaria u ON u.id = s.usuaria_id
      WHERE s.token_hash = $1 AND s.expira_en > now() AND s.revocada_en IS NULL
        AND u.anonimizada_en IS NULL`,
    [hash(token)],
  );
  return rows[0]?.usuaria_id ?? null;
}

export async function revocarSesiones(ejecutor: Ejecutor, usuariaId: string): Promise<void> {
  await ejecutor.query(`UPDATE sesion SET revocada_en = now() WHERE usuaria_id = $1 AND revocada_en IS NULL`, [
    usuariaId,
  ]);
}
