/**
 * RF-03: "Preferencias de agenda por usuaria: dias y franjas horarias viables,
 * con orden de prioridad. Estas preferencias alimentan las opciones que se le
 * ofrecen en T-21 dias."
 *
 * El objetivo del mensaje de T-21 no es preguntar "¿cuando puedes?" sino
 * ofrecer dos o tres opciones concretas que la usuaria contesta con un numero.
 * Ese es el trabajo que hace este modulo: convertir preferencias abstractas
 * ("martes y jueves por la manana, y si no, sabado") en fechas de calendario
 * alrededor de cuando toca el servicio.
 */
import type { OpcionHorario } from '../mensajes/contenido.js';
import {
  type FechaLocal,
  type ZonaHoraria,
  diaSemanaDe,
  fechaLocalDe,
  sumarDias,
} from '../../domain/tiempo.js';

export interface PreferenciaAgenda {
  /** Dia ISO de la semana: 1=lunes .. 7=domingo. */
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  /** Menor es mejor. */
  prioridad: number;
}

/** Cuantas opciones se ofrecen. Tres caben en un mensaje sin volverlo una lista. */
export const OPCIONES_POR_DEFECTO = 3;

/** Cuantos dias antes y despues de la fecha estimada se buscan huecos. */
export const DIAS_ANTES = 3;
export const DIAS_DESPUES = 10;

/**
 * Franja que se ofrece cuando la usuaria todavia no configuro preferencias.
 * Es horario de negocio en Mexico y deja margen para que el proveedor acomode.
 */
export const FRANJA_POR_DEFECTO = { horaInicio: '10:00', horaFin: '14:00' } as const;

function aFechaLocal(fecha: Date | FechaLocal, zona: ZonaHoraria): FechaLocal {
  return typeof fecha === 'string' ? fecha : fechaLocalDe(fecha, zona);
}

/**
 * Opciones concretas de dia y franja alrededor de la fecha estimada.
 *
 * Se ordenan por la prioridad que la usuaria dio a cada dia y, a igual
 * prioridad, por cercania a la fecha en que toca el servicio: no tiene sentido
 * ofrecerle el martes de dentro de tres semanas porque el martes sea su dia
 * favorito.
 *
 * Sin preferencias guardadas se ofrecen dias habiles cercanos con una franja
 * amplia; es peor no preguntar nada que preguntar con una suposicion razonable.
 */
export function opcionesDeHorario(
  preferencias: readonly PreferenciaAgenda[],
  fechaObjetivo: Date | FechaLocal,
  zona: ZonaHoraria,
  opciones: { cantidad?: number; noAntesDe?: FechaLocal } = {},
): OpcionHorario[] {
  const cantidad = opciones.cantidad ?? OPCIONES_POR_DEFECTO;
  const objetivo = aFechaLocal(fechaObjetivo, zona);

  const candidatas: Array<OpcionHorario & { prioridad: number; distancia: number }> = [];

  for (let delta = -DIAS_ANTES; delta <= DIAS_DESPUES; delta++) {
    const fecha = sumarDias(objetivo, delta);
    if (opciones.noAntesDe && fecha < opciones.noAntesDe) continue;

    const diaSemana = diaSemanaDe(fecha);
    const coincidencias = preferencias.filter((p) => p.diaSemana === diaSemana);

    if (coincidencias.length > 0) {
      for (const p of coincidencias) {
        candidatas.push({
          fecha,
          diaSemana,
          horaInicio: p.horaInicio.slice(0, 5),
          horaFin: p.horaFin.slice(0, 5),
          prioridad: p.prioridad,
          distancia: Math.abs(delta),
        });
      }
    } else if (preferencias.length === 0 && diaSemana <= 6) {
      // Sin preferencias: dias habiles y sabado, que es cuando abre una estetica.
      candidatas.push({
        fecha,
        diaSemana,
        ...FRANJA_POR_DEFECTO,
        prioridad: 1,
        distancia: Math.abs(delta),
      });
    }
  }

  candidatas.sort((a, b) => a.prioridad - b.prioridad || a.distancia - b.distancia || a.fecha.localeCompare(b.fecha));

  // Una sola opcion por dia: ofrecerle dos franjas del mismo martes confunde
  // mas de lo que ayuda.
  const vistas = new Set<FechaLocal>();
  const resultado: OpcionHorario[] = [];
  for (const c of candidatas) {
    if (vistas.has(c.fecha)) continue;
    vistas.add(c.fecha);
    resultado.push({ fecha: c.fecha, diaSemana: c.diaSemana, horaInicio: c.horaInicio, horaFin: c.horaFin });
    if (resultado.length === cantidad) break;
  }
  return resultado;
}
