/**
 * Enlace de alta para la clienta.
 *
 * En el piloto no hay API de WhatsApp que mande un código de verificación
 * (RF-01), y montarla solo para eso costaría el trámite de Meta completo antes
 * de tener una sola clienta. En su lugar: la operadora ya está hablando con
 * ella por WhatsApp, así que le pega un enlace por el mismo hilo.
 *
 * Es seguro para lo que es —un piloto de diez a veinte personas— porque:
 *   - el token es aleatorio de 32 bytes y solo se guarda su hash;
 *   - caduca;
 *   - da acceso a UNA clienta, la que la operadora acaba de crear;
 *   - se puede revocar.
 *
 * Lo que NO es: una forma de darse de alta sola. No hay registro abierto. Eso
 * es deliberado: sin verificación de identidad, un formulario público se llena
 * de basura el primer día.
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { Ejecutor } from '../../db/pool.js';

/** Cuánto dura el enlace. Suficiente para que lo abra el fin de semana. */
export const DIAS_DE_VIGENCIA = 14;

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface InvitacionCreada {
  /** El token en claro. Se devuelve UNA vez; después solo queda el hash. */
  token: string;
  expiraEn: Date;
}

/**
 * Crea un enlace para una clienta y revoca los anteriores.
 *
 * Revocar los viejos importa: si la operadora genera un enlace nuevo es porque
 * el anterior se perdió o se mandó a quien no era.
 */
export async function crearInvitacion(
  pool: pg.Pool,
  usuariaId: string,
  opciones: { operadorId?: string | null; diasDeVigencia?: number; ahora?: Date } = {},
): Promise<InvitacionCreada> {
  const ahora = opciones.ahora ?? new Date();
  const dias = opciones.diasDeVigencia ?? DIAS_DE_VIGENCIA;
  const expiraEn = new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000);
  const token = randomBytes(32).toString('base64url');

  await pool.query(
    `UPDATE invitacion SET revocada_en = $2
      WHERE usuaria_id = $1 AND revocada_en IS NULL AND completada_en IS NULL`,
    [usuariaId, ahora],
  );

  await pool.query(
    `INSERT INTO invitacion (usuaria_id, token_hash, creada_por, expira_en)
     VALUES ($1,$2,$3,$4)`,
    [usuariaId, hash(token), opciones.operadorId ?? null, expiraEn],
  );

  return { token, expiraEn };
}

export class InvitacionInvalida extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'InvitacionInvalida';
  }
}

/**
 * Canjea el token por la clienta a la que pertenece.
 *
 * Marca la invitación como abierta la primera vez, que es lo que permite ver en
 * el panel quién ni siquiera entró al enlace.
 */
export async function canjearInvitacion(
  pool: pg.Pool,
  token: string,
  opciones: { ahora?: Date } = {},
): Promise<{ usuariaId: string; invitacionId: string }> {
  const ahora = opciones.ahora ?? new Date();

  const { rows } = await pool.query<{
    id: string;
    usuaria_id: string;
    expira_en: Date;
    revocada_en: Date | null;
    anonimizada_en: Date | null;
  }>(
    `SELECT i.id, i.usuaria_id, i.expira_en, i.revocada_en, u.anonimizada_en
       FROM invitacion i
       JOIN usuaria u ON u.id = i.usuaria_id
      WHERE i.token_hash = $1`,
    [hash(token)],
  );

  const invitacion = rows[0];
  // El mismo mensaje para "no existe" y para "ya no sirve": distinguirlos le
  // diría a quien pruebe tokens al azar cuándo acertó a medias.
  const invalido = new InvitacionInvalida('Este enlace ya no sirve. Pídele uno nuevo a quien te lo mandó.');

  if (!invitacion) throw invalido;
  if (invitacion.revocada_en) throw invalido;
  if (invitacion.anonimizada_en) throw invalido;
  if (invitacion.expira_en.getTime() < ahora.getTime()) throw invalido;

  await pool.query(`UPDATE invitacion SET abierta_en = COALESCE(abierta_en, $2) WHERE id = $1`, [
    invitacion.id,
    ahora,
  ]);

  return { usuariaId: invitacion.usuaria_id, invitacionId: invitacion.id };
}

/** La clienta dio por terminada su alta. */
export async function completarInvitacion(ejecutor: Ejecutor, usuariaId: string): Promise<void> {
  await ejecutor.query(
    `UPDATE invitacion SET completada_en = now()
      WHERE usuaria_id = $1 AND revocada_en IS NULL AND completada_en IS NULL`,
    [usuariaId],
  );
}

export interface EstadoDeInvitacion {
  tiene: boolean;
  expiraEn: Date | null;
  abiertaEn: Date | null;
  completadaEn: Date | null;
  vencida: boolean;
}

/** Para que el panel muestre si la clienta ya entró y ya terminó. */
export async function estadoDeInvitacion(
  ejecutor: Ejecutor,
  usuariaId: string,
  ahora: Date = new Date(),
): Promise<EstadoDeInvitacion> {
  const { rows } = await ejecutor.query<{
    expira_en: Date;
    abierta_en: Date | null;
    completada_en: Date | null;
  }>(
    `SELECT expira_en, abierta_en, completada_en
       FROM invitacion
      WHERE usuaria_id = $1 AND revocada_en IS NULL
      ORDER BY creada_en DESC
      LIMIT 1`,
    [usuariaId],
  );

  const i = rows[0];
  if (!i) return { tiene: false, expiraEn: null, abiertaEn: null, completadaEn: null, vencida: false };
  return {
    tiene: true,
    expiraEn: i.expira_en,
    abiertaEn: i.abierta_en,
    completadaEn: i.completada_en,
    vencida: i.completada_en === null && i.expira_en.getTime() < ahora.getTime(),
  };
}
