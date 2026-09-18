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

  it('el catalogo cubre los cuatro avisos, la confirmacion, el cierre y el refuerzo', () => {
    expect(Object.keys(PLANTILLAS).sort()).toEqual([
      'huella_aviso_dia_indicaciones_v1',
      'huella_aviso_dia_v1',
      'huella_cierre_v1',
      'huella_confirmacion_v1',
      'huella_disponibilidad_v1',
      'huella_recordatorio_v1',
      'huella_refuerzo_v1',
    ]);
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
  const p = PLANTILLAS.huella_recordatorio_v1;

  it('sustituye en el orden declarado', () => {
    const texto = renderizar(p, ['el jueves a las 11:00', 'baño', 'Lola', 'Petco', 'Costo estimado: $450']);
    expect(texto).toContain('Recordatorio: el jueves a las 11:00 tienes el baño de Lola en Petco.');
  });

  it('rechaza una variable vacia, que Meta rechazaria en el envio', () => {
    expect(() => renderizar(p, ['a', 'b', 'c', 'd', '   '])).toThrow(PlantillaInvalida);
  });

  it('rechaza un numero de valores distinto al declarado', () => {
    expect(() => renderizar(p, ['a', 'b'])).toThrow(PlantillaInvalida);
  });
});
