import { describe, expect, it } from 'vitest';
import {
  PLANTILLAS,
  PlantillaInvalida,
  payloadDeAlta,
  renderizar,
  validarPlantilla,
  variablesDe,
} from '../../src/channels/whatsapp/plantillas.js';

const TODAS = Object.values(PLANTILLAS);

describe('plantillas de WhatsApp (seccion 08)', () => {
  it('todas cumplen las reglas de Meta', () => {
    for (const p of TODAS) {
      expect(() => validarPlantilla(p), p.nombre).not.toThrow();
    }
  });

  it('todas son transaccionales y en espanol de Mexico (RNF-01)', () => {
    for (const p of TODAS) {
      expect(p.categoria, p.nombre).toBe('UTILITY');
      expect(p.idioma, p.nombre).toBe('es_MX');
    }
  });

  it('el catálogo cubre cada momento y cada variante de dato opcional', () => {
    expect(Object.keys(PLANTILLAS).sort()).toEqual([
      'huella_aviso_dia_indicaciones_v2',
      'huella_aviso_dia_v2',
      'huella_cierre_puntual_sin_nombre_v2',
      'huella_cierre_puntual_v2',
      'huella_cierre_sin_nombre_v2',
      'huella_cierre_v2',
      'huella_confirmacion_v2',
      'huella_disponibilidad_sin_nombre_v2',
      'huella_disponibilidad_v2',
      'huella_recordatorio_3_v2',
      'huella_recordatorio_7_v2',
      'huella_refuerzo_v1',
    ]);
  });

  it('ninguna repite el mismo número de variable', () => {
    for (const p of TODAS) {
      const usados = variablesDe(p.cuerpo);
      expect(new Set(usados).size, p.nombre).toBe(usados.length);
    }
  });

  it('el payload de alta lleva un ejemplo por variable', () => {
    for (const p of TODAS) {
      const payload = payloadDeAlta(p) as {
        components: Array<{ example: { body_text: string[][] } }>;
      };
      expect(payload.components[0]!.example.body_text[0]).toHaveLength(p.variables.length);
    }
  });
});

describe('validarPlantilla', () => {
  const base = { nombre: 'x', categoria: 'UTILITY', idioma: 'es_MX' } as const;

  it('rechaza un cuerpo que empieza con variable', () => {
    expect(() => validarPlantilla({ ...base, cuerpo: '{{1}} tiene cita.', variables: ['a'] }))
      .toThrow(PlantillaInvalida);
  });

  it('rechaza un cuerpo que termina con variable', () => {
    expect(() => validarPlantilla({ ...base, cuerpo: 'La cita es {{1}}', variables: ['a'] }))
      .toThrow(PlantillaInvalida);
  });

  it('rechaza dos variables pegadas', () => {
    expect(() => validarPlantilla({ ...base, cuerpo: 'Hola {{1}} {{2}}.', variables: ['a', 'b'] }))
      .toThrow(PlantillaInvalida);
  });

  it('rechaza huecos en la numeracion', () => {
    expect(() => validarPlantilla({ ...base, cuerpo: 'Hola {{1}} y {{3}}.', variables: ['a', 'b'] }))
      .toThrow(PlantillaInvalida);
  });

  it('rechaza que el cuerpo y la documentacion de variables no cuadren', () => {
    expect(() => validarPlantilla({ ...base, cuerpo: 'Hola {{1}}.', variables: ['a', 'b'] }))
      .toThrow(PlantillaInvalida);
  });

  it('variablesDe encuentra los marcadores en orden', () => {
    expect(variablesDe('a {{1}} b {{2}} c {{1}}')).toEqual([1, 2, 1]);
  });
});

describe('renderizar', () => {
  const p = PLANTILLAS.huella_recordatorio_7_v2;
  const valores = ['el baño', 'Lola', 'jueves 22 de octubre', '11:00', 'Petco Polanco', '$450'];

  it('sustituye en el orden declarado', () => {
    expect(renderizar(p, valores)).toContain('Falta una semana para el baño de Lola.');
  });

  it('rechaza una variable vacía, que Meta rechazaría en el envío', () => {
    expect(() => renderizar(p, ['a', 'b', 'c', 'd', 'e', '   '])).toThrow(PlantillaInvalida);
  });

  it('rechaza un número de valores distinto al declarado', () => {
    expect(() => renderizar(p, ['a', 'b'])).toThrow(PlantillaInvalida);
  });

  // Ésta es la regla que rompía la versión anterior: la lista de opciones de
  // T−21 viajaba como un solo parámetro con saltos de línea, y Meta la habría
  // rechazado en el envío. Por eso ahora son tres variables.
  it('rechaza un valor con saltos de línea', () => {
    expect(() => renderizar(p, [...valores.slice(0, 5), '1) lunes\n2) martes'])).toThrow(/saltos de linea/i);
  });

  it('rechaza un valor con tabuladores o con cuatro espacios seguidos', () => {
    expect(() => renderizar(p, [...valores.slice(0, 5), 'a\tb'])).toThrow(PlantillaInvalida);
    expect(() => renderizar(p, [...valores.slice(0, 5), 'a    b'])).toThrow(PlantillaInvalida);
  });
});
