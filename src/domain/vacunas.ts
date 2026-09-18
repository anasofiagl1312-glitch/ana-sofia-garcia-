/**
 * RF-14: "Alertas independientes por vencimiento de vacuna o desparasitacion,
 * calculadas a partir de la ultima aplicacion registrada."
 *
 * Independientes quiere decir que no cuelgan de una cita: la usuaria recibe el
 * aviso aunque nunca haya agendado nada, porque el dato viene del carnet.
 */
import {
  type FechaLocal,
  type ZonaHoraria,
  diasEntre,
  hoyEn,
  instanteDesdeLocal,
  sumarDias,
} from './tiempo.js';
import { HORA_AVISO_POR_DEFECTO } from './agenda.js';

export interface AplicacionRegistrada {
  id: string;
  mascotaId: string;
  producto: string;
  tipoServicio: string | null;
  fechaAplicacion: FechaLocal;
  /** Fecha del siguiente refuerzo capturada del carnet, si viene. */
  fechaRefuerzo: FechaLocal | null;
}

/** Dias de anticipacion con los que se avisa un refuerzo. */
export const DIAS_AVISO_REFUERZO = [14, 0] as const;

/** A partir de cuantos dias de retraso se insiste. */
export const DIAS_INSISTENCIA_VENCIDA = [7, 30] as const;

export type ClaseAlerta = 'proxima' | 'hoy' | 'vencida';

export interface AlertaRefuerzo {
  aplicacionId: string;
  mascotaId: string;
  producto: string;
  fechaRefuerzo: FechaLocal;
  clase: ClaseAlerta;
  /** Dias de diferencia: negativo = faltan, positivo = vencida. */
  diasDeRetraso: number;
  /** Instante UTC en que debe salir el aviso. */
  programadoPara: Date;
}

/**
 * Fecha de refuerzo efectiva de una aplicacion.
 *
 * Si el carnet trae la fecha, manda esa. Si no, se deriva de la periodicidad
 * sugerida del tipo de servicio (RF-06). Si tampoco hay periodicidad, no hay
 * nada que avisar: es preferible callar a inventar una fecha medica.
 */
export function fechaRefuerzoEfectiva(
  aplicacion: AplicacionRegistrada,
  periodicidadPorServicio: Readonly<Record<string, number | null>>,
): FechaLocal | null {
  if (aplicacion.fechaRefuerzo) return aplicacion.fechaRefuerzo;
  if (!aplicacion.tipoServicio) return null;
  const dias = periodicidadPorServicio[aplicacion.tipoServicio];
  if (!dias) return null;
  return sumarDias(aplicacion.fechaAplicacion, dias);
}

/**
 * Se queda con la aplicacion mas reciente de cada producto por mascota.
 *
 * "Calculadas a partir de la ultima aplicacion registrada" (RF-14): si el
 * carnet trae tres refuerzos de la misma vacuna, solo el ultimo genera alerta.
 * Sin esto, cargar un carnet viejo dispararia una avalancha de avisos vencidos.
 */
export function ultimaAplicacionPorProducto(
  aplicaciones: readonly AplicacionRegistrada[],
): AplicacionRegistrada[] {
  const porClave = new Map<string, AplicacionRegistrada>();
  for (const aplicacion of aplicaciones) {
    const clave = `${aplicacion.mascotaId}::${aplicacion.producto.trim().toLowerCase()}`;
    const previa = porClave.get(clave);
    if (!previa || aplicacion.fechaAplicacion > previa.fechaAplicacion) {
      porClave.set(clave, aplicacion);
    }
  }
  return [...porClave.values()];
}

/**
 * Alertas que corresponden hoy para un conjunto de aplicaciones.
 *
 * Se evalua contra la fecha local de la usuaria, no contra el instante: un
 * refuerzo "vence el 25" vence el 25 en su ciudad.
 */
export function alertasDeRefuerzo(
  aplicaciones: readonly AplicacionRegistrada[],
  periodicidadPorServicio: Readonly<Record<string, number | null>>,
  zona: ZonaHoraria,
  ahora: Date = new Date(),
): AlertaRefuerzo[] {
  const hoy = hoyEn(zona, ahora);
  const alertas: AlertaRefuerzo[] = [];

  for (const aplicacion of ultimaAplicacionPorProducto(aplicaciones)) {
    const fechaRefuerzo = fechaRefuerzoEfectiva(aplicacion, periodicidadPorServicio);
    if (!fechaRefuerzo) continue;

    const diasDeRetraso = diasEntre(fechaRefuerzo, hoy);
    const faltan = -diasDeRetraso;

    const corresponde =
      (faltan > 0 && DIAS_AVISO_REFUERZO.includes(faltan as (typeof DIAS_AVISO_REFUERZO)[number])) ||
      diasDeRetraso === 0 ||
      DIAS_INSISTENCIA_VENCIDA.includes(diasDeRetraso as (typeof DIAS_INSISTENCIA_VENCIDA)[number]);

    if (!corresponde) continue;

    const clase: ClaseAlerta = diasDeRetraso > 0 ? 'vencida' : diasDeRetraso === 0 ? 'hoy' : 'proxima';

    alertas.push({
      aplicacionId: aplicacion.id,
      mascotaId: aplicacion.mascotaId,
      producto: aplicacion.producto,
      fechaRefuerzo,
      clase,
      diasDeRetraso,
      programadoPara: instanteDesdeLocal(hoy, HORA_AVISO_POR_DEFECTO, zona),
    });
  }

  return alertas.sort((a, b) => a.fechaRefuerzo.localeCompare(b.fechaRefuerzo));
}
