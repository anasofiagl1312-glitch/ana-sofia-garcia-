import { describe, expect, it } from 'vitest';
import {
  diaSemanaDe,
  diasEntre,
  fechaLocalDe,
  horaLocalDe,
  instanteDesdeLocal,
  sumarDias,
  sumarFrecuencia,
  validarZonaHoraria,
  ZonaHorariaInvalida,
} from '../../src/domain/tiempo.js';

const CDMX = 'America/Mexico_City';
/** Tijuana si observa horario de verano; sirve para probar RNF-02. */
const TIJUANA = 'America/Tijuana';

describe('instanteDesdeLocal', () => {
  it('convierte una hora local de CDMX a UTC', () => {
    // CDMX esta en UTC-6 todo el ano desde 2022.
    const instante = instanteDesdeLocal('2026-10-25', '11:00', CDMX);
    expect(instante.toISOString()).toBe('2026-10-25T17:00:00.000Z');
  });

  it('respeta el desplazamiento de cada zona', () => {
    const cdmx = instanteDesdeLocal('2026-07-15', '08:00', CDMX);
    const tijuana = instanteDesdeLocal('2026-07-15', '08:00', TIJUANA);
    expect(cdmx.toISOString()).toBe('2026-07-15T14:00:00.000Z');
    // Tijuana en julio esta en horario de verano del Pacifico (UTC-7).
    expect(tijuana.toISOString()).toBe('2026-07-15T15:00:00.000Z');
  });

  it('rechaza zonas horarias desconocidas', () => {
    expect(() => validarZonaHoraria('America/Atlantida')).toThrow(ZonaHorariaInvalida);
  });

  it('rechaza horas invalidas', () => {
    expect(() => instanteDesdeLocal('2026-01-01', '25:00', CDMX)).toThrow();
    expect(() => instanteDesdeLocal('2026-01-01', 'manana', CDMX)).toThrow();
  });

  it('no depende de la zona horaria del proceso', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Tokyo';
      const instante = instanteDesdeLocal('2026-10-25', '11:00', CDMX);
      expect(instante.toISOString()).toBe('2026-10-25T17:00:00.000Z');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('fechaLocalDe / horaLocalDe', () => {
  it('devuelve el dia local, que puede no ser el dia UTC', () => {
    // 04:00 UTC del 26 es todavia el 25 a las 22:00 en CDMX.
    const instante = new Date('2026-10-26T04:00:00.000Z');
    expect(fechaLocalDe(instante, CDMX)).toBe('2026-10-25');
    expect(horaLocalDe(instante, CDMX)).toBe('22:00');
  });

  it('es inverso de instanteDesdeLocal', () => {
    const instante = instanteDesdeLocal('2026-03-08', '07:30', TIJUANA);
    expect(fechaLocalDe(instante, TIJUANA)).toBe('2026-03-08');
    expect(horaLocalDe(instante, TIJUANA)).toBe('07:30');
  });
});

describe('sumarDias', () => {
  it('suma y resta dias de calendario', () => {
    expect(sumarDias('2026-10-25', -21)).toBe('2026-10-04');
    expect(sumarDias('2026-10-25', -7)).toBe('2026-10-18');
    expect(sumarDias('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('cruza fin de mes y fin de ano', () => {
    expect(sumarDias('2026-12-25', 10)).toBe('2027-01-04');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(sumarDias('2028-03-01', -1)).toBe('2028-02-29'); // bisiesto
  });
});

describe('sumarFrecuencia', () => {
  it('suma semanas', () => {
    expect(sumarFrecuencia('2026-10-01', 2, 'semanas')).toBe('2026-10-15');
  });

  it('suma meses conservando el dia del mes', () => {
    expect(sumarFrecuencia('2026-01-15', 1, 'meses')).toBe('2026-02-15');
    expect(sumarFrecuencia('2026-01-15', 6, 'meses')).toBe('2026-07-15');
  });

  it('recorta al ultimo dia cuando el dia no existe en el mes destino', () => {
    expect(sumarFrecuencia('2026-01-31', 1, 'meses')).toBe('2026-02-28');
    expect(sumarFrecuencia('2026-08-31', 1, 'meses')).toBe('2026-09-30');
  });

  it('"cada mes" no es lo mismo que "cada 30 dias" y por eso se guarda la unidad', () => {
    // Doce ciclos mensuales caen el mismo dia del ano siguiente...
    let porMes = '2026-01-10';
    for (let i = 0; i < 12; i++) porMes = sumarFrecuencia(porMes, 1, 'meses');
    expect(porMes).toBe('2027-01-10');

    // ...mientras que doce ciclos de 30 dias se adelantan cinco.
    let porDias = '2026-01-10';
    for (let i = 0; i < 12; i++) porDias = sumarDias(porDias, 30);
    expect(porDias).toBe('2027-01-05');
  });

  it('rechaza frecuencias invalidas', () => {
    expect(() => sumarFrecuencia('2026-01-01', 0, 'meses')).toThrow();
    expect(() => sumarFrecuencia('2026-01-01', -3, 'semanas')).toThrow();
  });
});

describe('diasEntre y diaSemanaDe', () => {
  it('cuenta dias de calendario con signo', () => {
    expect(diasEntre('2026-10-18', '2026-10-25')).toBe(7);
    expect(diasEntre('2026-10-25', '2026-10-18')).toBe(-7);
    expect(diasEntre('2026-10-25', '2026-10-25')).toBe(0);
  });

  it('devuelve el dia ISO de la semana', () => {
    expect(diaSemanaDe('2026-10-25')).toBe(7); // domingo
    expect(diaSemanaDe('2026-10-26')).toBe(1); // lunes
  });
});
