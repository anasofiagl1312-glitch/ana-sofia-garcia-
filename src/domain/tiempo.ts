/**
 * Manejo de fechas y horas.
 *
 * RNF-02: "Todas las fechas y horas se manejan en la zona horaria de la usuaria,
 * con almacenamiento en UTC. El cambio de horario no debe correr ningun
 * recordatorio."
 *
 * De ahi salen las dos reglas que sigue todo este modulo:
 *
 *   1. Un recordatorio se define por su HORA LOCAL DE PARED ("el jueves a las
 *      8 de la manana"), no por un desplazamiento fijo en horas contra la cita.
 *      El instante UTC se deriva de esa hora local usando la base de zonas
 *      horarias, que ya sabe donde cae cada cambio de horario. Si se hiciera al
 *      reves -- restar 7*24 horas al instante UTC de la cita -- un cambio de
 *      horario entre hoy y la cita correria el aviso una hora.
 *
 *   2. Nada en el sistema usa la zona horaria del servidor. Toda conversion
 *      recibe la zona de la usuaria explicitamente.
 *
 * Mexico suprimio el horario de verano en casi todo el pais en 2022, pero
 * varios municipios de la frontera norte lo siguen observando y el producto
 * apunta a mas ciudades, asi que el caso esta vivo y probado.
 */
import { DateTime } from 'luxon';

export type ZonaHoraria = string;

/** 'YYYY-MM-DD' */
export type FechaLocal = string;

/** 'HH:MM' o 'HH:MM:SS' */
export type HoraLocal = string;

export class ZonaHorariaInvalida extends Error {
  constructor(zona: string) {
    super(`Zona horaria desconocida: ${zona}`);
    this.name = 'ZonaHorariaInvalida';
  }
}

export function validarZonaHoraria(zona: ZonaHoraria): void {
  if (!DateTime.local().setZone(zona).isValid) throw new ZonaHorariaInvalida(zona);
}

function partesHora(hora: HoraLocal): { hour: number; minute: number; second: number } {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hora);
  if (!m) throw new Error(`Hora local invalida: ${hora}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`Hora local invalida: ${hora}`);
  return { hour, minute, second };
}

/**
 * Combina una fecha local y una hora local en el instante UTC correspondiente.
 *
 * Casos de borde del cambio de horario:
 *  - Hora inexistente (el reloj salta de 1:59 a 3:00): Luxon la corre hacia
 *    adelante, que es lo que quiere la usuaria -- el aviso sale, no se pierde.
 *  - Hora ambigua (el reloj repite 1:00-1:59): se toma la primera ocurrencia.
 */
export function instanteDesdeLocal(fecha: FechaLocal, hora: HoraLocal, zona: ZonaHoraria): Date {
  validarZonaHoraria(zona);
  const { hour, minute, second } = partesHora(hora);
  const dt = DateTime.fromISO(fecha, { zone: zona }).set({ hour, minute, second, millisecond: 0 });
  if (!dt.isValid) throw new Error(`Fecha local invalida: ${fecha} (${dt.invalidReason})`);
  return dt.toJSDate();
}

/** Fecha local ('YYYY-MM-DD') en la que cae un instante, vista desde `zona`. */
export function fechaLocalDe(instante: Date, zona: ZonaHoraria): FechaLocal {
  validarZonaHoraria(zona);
  return DateTime.fromJSDate(instante).setZone(zona).toFormat('yyyy-MM-dd');
}

/** Hora local ('HH:MM') a la que cae un instante, vista desde `zona`. */
export function horaLocalDe(instante: Date, zona: ZonaHoraria): HoraLocal {
  validarZonaHoraria(zona);
  return DateTime.fromJSDate(instante).setZone(zona).toFormat('HH:mm');
}

/**
 * Suma dias de CALENDARIO a una fecha local.
 *
 * Deliberadamente opera sobre la fecha, no sobre un instante: "siete dias antes
 * del jueves 25" es el jueves 18, haya habido o no cambio de horario en medio.
 */
export function sumarDias(fecha: FechaLocal, dias: number): FechaLocal {
  const dt = DateTime.fromISO(fecha, { zone: 'utc' });
  if (!dt.isValid) throw new Error(`Fecha local invalida: ${fecha}`);
  return dt.plus({ days: dias }).toFormat('yyyy-MM-dd');
}

/**
 * Suma semanas o meses a una fecha local.
 *
 * RF-05 pide la frecuencia "en semanas o meses" y la distincion importa: "cada
 * mes" significa el mismo dia del mes siguiente, no 30 dias despues. A los doce
 * ciclos las dos interpretaciones ya difieren en cinco dias, y la usuaria que
 * eligio "cada mes" espera que su baño caiga siempre a principios de mes.
 *
 * Cuando el dia no existe en el mes destino (31 de enero + 1 mes) se recorta al
 * ultimo dia del mes, que es la convencion que la gente espera.
 */
export function sumarFrecuencia(fecha: FechaLocal, cantidad: number, unidad: 'semanas' | 'meses'): FechaLocal {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new Error(`Frecuencia invalida: ${cantidad}`);
  }
  const dt = DateTime.fromISO(fecha, { zone: 'utc' });
  if (!dt.isValid) throw new Error(`Fecha local invalida: ${fecha}`);
  const sumado = unidad === 'semanas' ? dt.plus({ weeks: cantidad }) : dt.plus({ months: cantidad });
  return sumado.toFormat('yyyy-MM-dd');
}

/** Dias de calendario entre dos fechas locales (b - a). */
export function diasEntre(a: FechaLocal, b: FechaLocal): number {
  const da = DateTime.fromISO(a, { zone: 'utc' });
  const db = DateTime.fromISO(b, { zone: 'utc' });
  if (!da.isValid || !db.isValid) throw new Error(`Fecha local invalida: ${a} / ${b}`);
  return Math.round(db.diff(da, 'days').days);
}

/** Dia de la semana ISO (1=lunes ... 7=domingo) de una fecha local. */
export function diaSemanaDe(fecha: FechaLocal): number {
  const dt = DateTime.fromISO(fecha, { zone: 'utc' });
  if (!dt.isValid) throw new Error(`Fecha local invalida: ${fecha}`);
  return dt.weekday;
}

/** Hoy, en la zona de la usuaria. */
export function hoyEn(zona: ZonaHoraria, ahora: Date = new Date()): FechaLocal {
  return fechaLocalDe(ahora, zona);
}
