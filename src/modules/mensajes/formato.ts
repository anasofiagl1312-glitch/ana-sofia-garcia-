/**
 * Formato de fechas y montos en espanol de Mexico (RNF-01).
 *
 * Todo texto que ve la usuaria pasa por aqui. Ninguna funcion usa la zona
 * horaria del servidor: la zona se recibe siempre como argumento.
 */
import { DateTime } from 'luxon';
import type { FechaLocal, ZonaHoraria } from '../../domain/tiempo.js';

const LOCALE = 'es-MX';

/** "jueves 25 de octubre" */
export function fechaLarga(instante: Date, zona: ZonaHoraria): string {
  return DateTime.fromJSDate(instante).setZone(zona).setLocale(LOCALE).toFormat("cccc d 'de' LLLL");
}

/** "jueves 25 de octubre de 2026" -- para cuando la cita cae en otro ano. */
export function fechaLargaConAnio(instante: Date, zona: ZonaHoraria): string {
  return DateTime.fromJSDate(instante).setZone(zona).setLocale(LOCALE).toFormat("cccc d 'de' LLLL 'de' yyyy");
}

/** "25 de octubre de 2026" a partir de una fecha sin hora. */
export function fechaLargaDeFechaLocal(fecha: FechaLocal): string {
  return DateTime.fromISO(fecha, { zone: 'utc' }).setLocale(LOCALE).toFormat("d 'de' LLLL 'de' yyyy");
}

/** "11:00" -- reloj de 24 horas, que es como se escribe una cita en Mexico. */
export function hora(instante: Date, zona: ZonaHoraria): string {
  return DateTime.fromJSDate(instante).setZone(zona).toFormat('HH:mm');
}

/**
 * "el jueves 25 de octubre a las 11:00", agregando el ano solo cuando la cita
 * no cae en el ano en curso. Decir "de 2026" en octubre de 2026 es ruido.
 */
export function fechaYHora(instante: Date, zona: ZonaHoraria, referencia: Date = new Date()): string {
  const cita = DateTime.fromJSDate(instante).setZone(zona);
  const hoy = DateTime.fromJSDate(referencia).setZone(zona);
  const larga = cita.year === hoy.year ? fechaLarga(instante, zona) : fechaLargaConAnio(instante, zona);
  return `el ${larga} a las ${hora(instante, zona)}`;
}

/**
 * "$450" o "$450.50". Pesos mexicanos, sin centavos cuando son cero, que es
 * como los cotiza una estetica.
 */
export function monto(pesos: number): string {
  const entero = Number.isInteger(pesos);
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: entero ? 0 : 2,
    maximumFractionDigits: entero ? 0 : 2,
  })
    .format(pesos)
    // Intl en es-MX produce "$450"; en algunos entornos "MX$450". Se normaliza
    // porque la usuaria cotiza en pesos y el prefijo de pais sobra.
    .replace(/^MX\$/, '$');
}

/** Franja horaria legible: "de 10:00 a 13:00". */
export function franja(inicio: string, fin: string): string {
  return `de ${inicio.slice(0, 5)} a ${fin.slice(0, 5)}`;
}

const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

/** Nombre del dia a partir del numero ISO (1=lunes). */
export function nombreDia(diaSemanaIso: number): string {
  return DIAS[diaSemanaIso] ?? '';
}
