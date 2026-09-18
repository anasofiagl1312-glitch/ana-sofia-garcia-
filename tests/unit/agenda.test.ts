import { describe, expect, it } from 'vitest';
import {
  HORA_AVISO_POR_DEFECTO,
  MINUTOS_MINIMOS_ANTES_DE_LA_CITA,
  esDesactivable,
  instanteDeConsultaDisponibilidad,
  instanteDelMomento,
  programaDeRecordatorios,
  recalcularPendientes,
  siguienteFechaEstimada,
} from '../../src/domain/agenda.js';
import { fechaLocalDe, horaLocalDe, instanteDesdeLocal } from '../../src/domain/tiempo.js';

const CDMX = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';

/** El ejemplo del documento: baño de Lola, 25 de octubre a las 11:00. */
const CITA_LOLA = instanteDesdeLocal('2026-10-25', '11:00', CDMX);
const BASE = { iniciaEn: CITA_LOLA, zona: CDMX, horaAvisoDia: '08:00' };

describe('instanteDelMomento', () => {
  it('coloca cada aviso en su dia de calendario', () => {
    expect(fechaLocalDe(instanteDelMomento('t_21', BASE), CDMX)).toBe('2026-10-04');
    expect(fechaLocalDe(instanteDelMomento('t_7', BASE), CDMX)).toBe('2026-10-18');
    expect(fechaLocalDe(instanteDelMomento('t_3', BASE), CDMX)).toBe('2026-10-22');
    expect(fechaLocalDe(instanteDelMomento('t_0', BASE), CDMX)).toBe('2026-10-25');
    expect(fechaLocalDe(instanteDelMomento('cierre', BASE), CDMX)).toBe('2026-10-26');
  });

  it('manda los avisos intermedios a la hora por defecto', () => {
    for (const momento of ['t_21', 't_7', 't_3'] as const) {
      expect(horaLocalDe(instanteDelMomento(momento, BASE), CDMX)).toBe(HORA_AVISO_POR_DEFECTO);
    }
  });

  it('manda el aviso del dia a la hora que eligio la usuaria (RF-13)', () => {
    expect(horaLocalDe(instanteDelMomento('t_0', BASE), CDMX)).toBe('08:00');
    const temprano = { ...BASE, horaAvisoDia: '06:30' };
    expect(horaLocalDe(instanteDelMomento('t_0', temprano), CDMX)).toBe('06:30');
  });

  it('adelanta el aviso del dia cuando la cita es antes que la hora elegida', () => {
    // Cita a las 7:00 y aviso del dia configurado a las 8:00: el aviso llegaria
    // una hora despues de la cita.
    const citaTemprana = instanteDesdeLocal('2026-10-25', '07:00', CDMX);
    const instante = instanteDelMomento('t_0', { ...BASE, iniciaEn: citaTemprana });
    expect(horaLocalDe(instante, CDMX)).toBe('06:00');
    expect(citaTemprana.getTime() - instante.getTime()).toBe(MINUTOS_MINIMOS_ANTES_DE_LA_CITA * 60_000);
  });
});

describe('RNF-02: el cambio de horario no corre ningun recordatorio', () => {
  // En 2026 Tijuana sale del horario de verano el domingo 1 de noviembre.
  // Una cita despues del cambio con avisos antes del cambio es justo el caso
  // que el requerimiento senala.
  const citaDespuesDelCambio = instanteDesdeLocal('2026-11-05', '11:00', TIJUANA);
  const opciones = { iniciaEn: citaDespuesDelCambio, zona: TIJUANA, horaAvisoDia: '08:00' };

  it('mantiene la hora local de pared aunque el aviso caiga del otro lado del cambio', () => {
    const t21 = instanteDelMomento('t_21', opciones); // 15 de octubre, aun en horario de verano
    const t7 = instanteDelMomento('t_7', opciones); // 29 de octubre, aun en horario de verano
    const t0 = instanteDelMomento('t_0', opciones); // 5 de noviembre, ya en horario estandar

    expect(horaLocalDe(t21, TIJUANA)).toBe('10:00');
    expect(horaLocalDe(t7, TIJUANA)).toBe('10:00');
    expect(horaLocalDe(t0, TIJUANA)).toBe('08:00');

    // Y efectivamente cruzan el cambio: el desplazamiento UTC no es el mismo.
    expect(t7.toISOString()).toBe('2026-10-29T17:00:00.000Z'); // UTC-7
    expect(t0.toISOString()).toBe('2026-11-05T16:00:00.000Z'); // UTC-8
  });

  it('restar 168 horas al instante de la cita habria corrido el aviso una hora', () => {
    const correcto = instanteDelMomento('t_7', opciones);
    // La forma ingenua: tomar el instante UTC de la cita y restarle 7 dias.
    const ingenuo = new Date(citaDespuesDelCambio.getTime() - 7 * 24 * 60 * 60 * 1000);

    expect(horaLocalDe(citaDespuesDelCambio, TIJUANA)).toBe('11:00');
    // El ingenuo cae a las 12:00 locales, no a las 11:00: se corrio una hora.
    expect(horaLocalDe(ingenuo, TIJUANA)).toBe('12:00');
    expect(horaLocalDe(correcto, TIJUANA)).toBe('10:00');
  });

  it('no se cae cuando la hora elegida no existe por el salto de primavera', () => {
    // El 8 de marzo de 2026 Tijuana salta de las 2:00 a las 3:00.
    const cita = instanteDesdeLocal('2026-03-08', '14:00', TIJUANA);
    const instante = instanteDelMomento('t_0', { iniciaEn: cita, zona: TIJUANA, horaAvisoDia: '02:30' });
    expect(Number.isNaN(instante.getTime())).toBe(false);
    // Luxon corre la hora inexistente hacia adelante: el aviso sale, no se pierde.
    expect(instante.getTime()).toBeLessThan(cita.getTime());
    expect(fechaLocalDe(instante, TIJUANA)).toBe('2026-03-08');
  });
});

describe('programaDeRecordatorios', () => {
  const muyAntes = new Date('2026-09-01T00:00:00Z');

  it('devuelve los cinco momentos en orden cronologico', () => {
    const programa = programaDeRecordatorios({ ...BASE, ahora: muyAntes });
    expect(programa.map((r) => r.momento)).toEqual(['t_21', 't_7', 't_3', 't_0', 'cierre']);
    const instantes = programa.map((r) => r.programadoPara.getTime());
    expect(instantes).toEqual([...instantes].sort((a, b) => a - b));
  });

  it('omite los avisos que ya quedaron atras (RNF-03: un aviso tarde es inutil)', () => {
    // Se agenda con diez dias de anticipacion: T-21 ya paso.
    const ahora = instanteDesdeLocal('2026-10-15', '09:00', CDMX);
    const programa = programaDeRecordatorios({ ...BASE, ahora });
    expect(programa.map((r) => r.momento)).toEqual(['t_7', 't_3', 't_0', 'cierre']);
  });

  it('respeta los recordatorios que la usuaria apago (RF-13)', () => {
    const programa = programaDeRecordatorios({ ...BASE, ahora: muyAntes, desactivados: ['t_7', 't_3'] });
    expect(programa.map((r) => r.momento)).toEqual(['t_21', 't_0', 'cierre']);
  });

  it('ignora el intento de apagar T-21 o el cierre', () => {
    expect(esDesactivable('t_21')).toBe(false);
    expect(esDesactivable('cierre')).toBe(false);
    expect(esDesactivable('t_0')).toBe(true);
    const programa = programaDeRecordatorios({ ...BASE, ahora: muyAntes, desactivados: ['t_21', 'cierre'] });
    expect(programa.map((r) => r.momento)).toContain('t_21');
    expect(programa.map((r) => r.momento)).toContain('cierre');
  });
});

describe('recalcularPendientes', () => {
  it('reprograma solo lo que falta cuando se reagenda la cita', () => {
    // Ya salieron T-21 y T-7; la cita se mueve del 25 al 30 de octubre.
    const nuevaFecha = instanteDesdeLocal('2026-10-30', '11:00', CDMX);
    const ahora = instanteDesdeLocal('2026-10-19', '12:00', CDMX);

    const pendientes = recalcularPendientes(['t_21', 't_7'], {
      iniciaEn: nuevaFecha,
      zona: CDMX,
      horaAvisoDia: '08:00',
      ahora,
    });

    expect(pendientes.map((r) => r.momento)).toEqual(['t_3', 't_0', 'cierre']);
    expect(fechaLocalDe(pendientes[0]!.programadoPara, CDMX)).toBe('2026-10-27');
    expect(fechaLocalDe(pendientes[1]!.programadoPara, CDMX)).toBe('2026-10-30');
    expect(fechaLocalDe(pendientes[2]!.programadoPara, CDMX)).toBe('2026-10-31');
  });

  it('reprograma tambien un T-7 que vuelve a caer en el futuro al posponerse la cita', () => {
    // La cita se empuja un mes: T-7 todavia no habia salido y ahora cabe.
    const nuevaFecha = instanteDesdeLocal('2026-11-25', '11:00', CDMX);
    const ahora = instanteDesdeLocal('2026-10-19', '12:00', CDMX);
    const pendientes = recalcularPendientes(['t_21'], {
      iniciaEn: nuevaFecha,
      zona: CDMX,
      horaAvisoDia: '08:00',
      ahora,
    });
    expect(pendientes.map((r) => r.momento)).toEqual(['t_7', 't_3', 't_0', 'cierre']);
  });
});

describe('instanteDeConsultaDisponibilidad (RF-08)', () => {
  it('dispara la consulta 21 dias antes de la fecha estimada', () => {
    const instante = instanteDeConsultaDisponibilidad('2026-10-25', 21, CDMX);
    expect(fechaLocalDe(instante, CDMX)).toBe('2026-10-04');
    expect(horaLocalDe(instante, CDMX)).toBe(HORA_AVISO_POR_DEFECTO);
  });

  it('acepta una anticipacion distinta por rutina', () => {
    const instante = instanteDeConsultaDisponibilidad('2026-10-25', 10, CDMX);
    expect(fechaLocalDe(instante, CDMX)).toBe('2026-10-15');
  });
});

describe('siguienteFechaEstimada', () => {
  it('cuenta desde la fecha en que la cita realmente se cumplio', () => {
    // La rutina era mensual y estaba estimada para el 25, pero se hizo el 30.
    expect(siguienteFechaEstimada('2026-10-30', 1, 'meses')).toBe('2026-11-30');
  });

  it('no arrastra el desfase acumulado', () => {
    // Si se contara desde la estimacion original, doce ciclos con dos dias de
    // retraso cada uno terminarian pidiendo dos baños en la misma quincena.
    let fecha = '2026-01-05';
    for (let i = 0; i < 6; i++) fecha = siguienteFechaEstimada(fecha, 1, 'meses');
    expect(fecha).toBe('2026-07-05');
  });
});
