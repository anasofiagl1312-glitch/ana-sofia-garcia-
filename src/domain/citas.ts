/**
 * Maquina de estados de una cita.
 *
 * Los estados son los de la seccion 07, sin agregar ni quitar:
 *   solicitada -> por_confirmar_con_proveedor -> confirmada -> cumplida
 * y los alternos reagendada, cancelada y requiere_atencion_humana.
 *
 * Tenerlo como tabla explicita y no como ifs repartidos por el codigo evita el
 * caso que mas duele en este producto: una cita que quedo en un estado raro y
 * sigue mandando recordatorios de algo que ya se cancelo.
 */

export type EstadoCita =
  | 'solicitada'
  | 'por_confirmar_con_proveedor'
  | 'confirmada'
  | 'cumplida'
  | 'reagendada'
  | 'cancelada'
  | 'requiere_atencion_humana';

const TRANSICIONES: Record<EstadoCita, readonly EstadoCita[]> = {
  // Creada al disparar la consulta de disponibilidad (T-21), antes de que la
  // usuaria elija horario.
  solicitada: ['por_confirmar_con_proveedor', 'cancelada', 'requiere_atencion_humana'],

  // La usuaria ya eligio; falta que el proveedor aparte y confirme el precio.
  por_confirmar_con_proveedor: ['confirmada', 'requiere_atencion_humana', 'cancelada', 'reagendada'],

  // El proveedor aparto. A partir de aqui salen T-7, T-3 y T-0.
  confirmada: ['cumplida', 'reagendada', 'cancelada', 'requiere_atencion_humana'],

  // RF-10: el agente no pudo cerrar. Una operadora la retoma.
  requiere_atencion_humana: ['por_confirmar_con_proveedor', 'confirmada', 'cancelada', 'reagendada'],

  // Terminales.
  cumplida: [],
  reagendada: [],
  cancelada: [],
};

/** Estados en los que la cita ya no cambia. */
export const ESTADOS_TERMINALES: readonly EstadoCita[] = ['cumplida', 'reagendada', 'cancelada'];

/** Estados en los que todavia tiene sentido mandar recordatorios. */
export const ESTADOS_CON_RECORDATORIOS: readonly EstadoCita[] = [
  'solicitada',
  'por_confirmar_con_proveedor',
  'confirmada',
];

export class TransicionInvalida extends Error {
  constructor(
    readonly desde: EstadoCita,
    readonly hacia: EstadoCita,
  ) {
    super(`Una cita en estado "${desde}" no puede pasar a "${hacia}".`);
    this.name = 'TransicionInvalida';
  }
}

export function puedeTransicionar(desde: EstadoCita, hacia: EstadoCita): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export function transicionesPosibles(desde: EstadoCita): readonly EstadoCita[] {
  return TRANSICIONES[desde];
}

export function asegurarTransicion(desde: EstadoCita, hacia: EstadoCita): void {
  if (!puedeTransicionar(desde, hacia)) throw new TransicionInvalida(desde, hacia);
}

export function esTerminal(estado: EstadoCita): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

export function aceptaRecordatorios(estado: EstadoCita): boolean {
  return ESTADOS_CON_RECORDATORIOS.includes(estado);
}

/**
 * Seccion 05: "El agente siempre pregunta el precio y lo registra. Si el
 * proveedor no lo da, la cita se marca como «costo por confirmar» y asi se le
 * comunica a la usuaria."
 *
 * No hay un estado aparte para eso -- es ortogonal al estado de la cita -- sino
 * la ausencia de costo confirmado.
 */
export function costoPorConfirmar(costoConfirmado: number | null | undefined): boolean {
  return costoConfirmado === null || costoConfirmado === undefined;
}
