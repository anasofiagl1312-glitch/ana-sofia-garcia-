import { describe, expect, it } from 'vitest';
import {
  type AplicacionRegistrada,
  alertasDeRefuerzo,
  fechaRefuerzoEfectiva,
  ultimaAplicacionPorProducto,
} from '../../src/domain/vacunas.js';
import { fechaLocalDe, instanteDesdeLocal } from '../../src/domain/tiempo.js';

const CDMX = 'America/Mexico_City';
const PERIODICIDAD = { vacunacion: 365, desparasitacion: 90, antipulgas: 30, bano: null };

function aplicacion(parcial: Partial<AplicacionRegistrada> & { id: string }): AplicacionRegistrada {
  return {
    mascotaId: 'lola',
    producto: 'Rabia',
    tipoServicio: 'vacunacion',
    fechaAplicacion: '2026-01-10',
    fechaRefuerzo: null,
    ...parcial,
  };
}

describe('fechaRefuerzoEfectiva', () => {
  it('prefiere la fecha que trae el carnet', () => {
    const app = aplicacion({ id: '1', fechaRefuerzo: '2027-02-01' });
    expect(fechaRefuerzoEfectiva(app, PERIODICIDAD)).toBe('2027-02-01');
  });

  it('la deriva de la periodicidad del servicio cuando el carnet no la trae', () => {
    const app = aplicacion({ id: '1', tipoServicio: 'desparasitacion', fechaAplicacion: '2026-01-10' });
    expect(fechaRefuerzoEfectiva(app, PERIODICIDAD)).toBe('2026-04-10');
  });

  it('calla cuando no hay forma de saberlo, en vez de inventar una fecha medica', () => {
    expect(fechaRefuerzoEfectiva(aplicacion({ id: '1', tipoServicio: null }), PERIODICIDAD)).toBeNull();
    expect(fechaRefuerzoEfectiva(aplicacion({ id: '1', tipoServicio: 'bano' }), PERIODICIDAD)).toBeNull();
  });
});

describe('ultimaAplicacionPorProducto', () => {
  it('se queda con la mas reciente de cada producto', () => {
    const resultado = ultimaAplicacionPorProducto([
      aplicacion({ id: 'vieja', producto: 'Rabia', fechaAplicacion: '2024-01-10' }),
      aplicacion({ id: 'nueva', producto: 'Rabia', fechaAplicacion: '2026-01-10' }),
      aplicacion({ id: 'otra', producto: 'Triple felina', fechaAplicacion: '2025-06-01' }),
    ]);
    expect(resultado.map((a) => a.id).sort()).toEqual(['nueva', 'otra']);
  });

  it('no confunde el mismo producto de dos mascotas distintas', () => {
    const resultado = ultimaAplicacionPorProducto([
      aplicacion({ id: 'lola', mascotaId: 'lola', producto: 'Rabia' }),
      aplicacion({ id: 'fito', mascotaId: 'fito', producto: 'Rabia' }),
    ]);
    expect(resultado).toHaveLength(2);
  });

  it('compara sin distinguir mayusculas ni espacios sobrantes', () => {
    const resultado = ultimaAplicacionPorProducto([
      aplicacion({ id: 'a', producto: 'rabia', fechaAplicacion: '2025-01-01' }),
      aplicacion({ id: 'b', producto: '  Rabia ', fechaAplicacion: '2026-01-01' }),
    ]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]!.id).toBe('b');
  });
});

describe('alertasDeRefuerzo (RF-14)', () => {
  const app = aplicacion({ id: '1', fechaRefuerzo: '2026-10-25' });

  function enFecha(fecha: string) {
    return alertasDeRefuerzo([app], PERIODICIDAD, CDMX, instanteDesdeLocal(fecha, '09:00', CDMX));
  }

  it('avisa catorce dias antes', () => {
    const alertas = enFecha('2026-10-11');
    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.clase).toBe('proxima');
    expect(alertas[0]!.diasDeRetraso).toBe(-14);
  });

  it('avisa el mismo dia del vencimiento', () => {
    const alertas = enFecha('2026-10-25');
    expect(alertas[0]!.clase).toBe('hoy');
    expect(alertas[0]!.diasDeRetraso).toBe(0);
  });

  it('insiste a los siete y a los treinta dias de vencida', () => {
    expect(enFecha('2026-11-01')[0]!.clase).toBe('vencida');
    expect(enFecha('2026-11-24')[0]!.clase).toBe('vencida');
  });

  it('no avisa los dias que no toca', () => {
    expect(enFecha('2026-10-12')).toEqual([]);
    expect(enFecha('2026-10-20')).toEqual([]);
    expect(enFecha('2026-11-05')).toEqual([]);
  });

  it('programa el aviso en la manana local de la usuaria', () => {
    const alertas = enFecha('2026-10-25');
    expect(fechaLocalDe(alertas[0]!.programadoPara, CDMX)).toBe('2026-10-25');
  });

  it('cargar un carnet viejo no dispara una avalancha de avisos vencidos', () => {
    // Tres refuerzos de la misma vacuna: solo el ultimo cuenta.
    const historial = [
      aplicacion({ id: 'a', producto: 'Rabia', fechaAplicacion: '2023-10-25', fechaRefuerzo: '2024-10-25' }),
      aplicacion({ id: 'b', producto: 'Rabia', fechaAplicacion: '2024-10-25', fechaRefuerzo: '2025-10-25' }),
      aplicacion({ id: 'c', producto: 'Rabia', fechaAplicacion: '2025-10-25', fechaRefuerzo: '2026-10-25' }),
    ];
    const alertas = alertasDeRefuerzo(
      historial,
      PERIODICIDAD,
      CDMX,
      instanteDesdeLocal('2026-10-25', '09:00', CDMX),
    );
    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.aplicacionId).toBe('c');
  });

  it('ordena por fecha de vencimiento cuando hay varias', () => {
    const alertas = alertasDeRefuerzo(
      [
        aplicacion({ id: '1', producto: 'Rabia', fechaRefuerzo: '2026-10-25' }),
        aplicacion({ id: '2', producto: 'Desparasitante', fechaRefuerzo: '2026-10-11' }),
      ],
      PERIODICIDAD,
      CDMX,
      instanteDesdeLocal('2026-10-11', '09:00', CDMX),
    );
    // El 11 de octubre: uno vence hoy y el otro en catorce dias.
    expect(alertas.map((a) => a.producto)).toEqual(['Desparasitante', 'Rabia']);
    expect(alertas.map((a) => a.clase)).toEqual(['hoy', 'proxima']);
  });
});
