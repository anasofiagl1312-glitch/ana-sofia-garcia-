import { describe, expect, it } from 'vitest';
import {
  type EstadoCita,
  ESTADOS_TERMINALES,
  TransicionInvalida,
  aceptaRecordatorios,
  asegurarTransicion,
  costoPorConfirmar,
  esTerminal,
  puedeTransicionar,
  transicionesPosibles,
} from '../../src/domain/citas.js';

const TODOS: EstadoCita[] = [
  'solicitada',
  'por_confirmar_con_proveedor',
  'confirmada',
  'cumplida',
  'reagendada',
  'cancelada',
  'requiere_atencion_humana',
];

describe('maquina de estados de la cita', () => {
  it('recorre el camino feliz de la seccion 07', () => {
    expect(puedeTransicionar('solicitada', 'por_confirmar_con_proveedor')).toBe(true);
    expect(puedeTransicionar('por_confirmar_con_proveedor', 'confirmada')).toBe(true);
    expect(puedeTransicionar('confirmada', 'cumplida')).toBe(true);
  });

  it('no permite saltarse pasos', () => {
    expect(puedeTransicionar('solicitada', 'confirmada')).toBe(false);
    expect(puedeTransicionar('solicitada', 'cumplida')).toBe(false);
    expect(() => asegurarTransicion('solicitada', 'cumplida')).toThrow(TransicionInvalida);
  });

  it('deja los estados terminales cerrados', () => {
    for (const terminal of ESTADOS_TERMINALES) {
      expect(esTerminal(terminal)).toBe(true);
      expect(transicionesPosibles(terminal)).toEqual([]);
      for (const destino of TODOS) {
        expect(puedeTransicionar(terminal, destino)).toBe(false);
      }
    }
  });

  it('permite escalar a revision humana desde cualquier estado vivo (RF-10)', () => {
    for (const estado of ['solicitada', 'por_confirmar_con_proveedor', 'confirmada'] as const) {
      expect(puedeTransicionar(estado, 'requiere_atencion_humana')).toBe(true);
    }
  });

  it('deja que la operadora saque un caso de la bandeja', () => {
    expect(puedeTransicionar('requiere_atencion_humana', 'confirmada')).toBe(true);
    expect(puedeTransicionar('requiere_atencion_humana', 'cancelada')).toBe(true);
    expect(puedeTransicionar('requiere_atencion_humana', 'reagendada')).toBe(true);
  });

  it('permite cancelar cualquier cita viva (RF-11)', () => {
    for (const estado of ['solicitada', 'por_confirmar_con_proveedor', 'confirmada', 'requiere_atencion_humana'] as const) {
      expect(puedeTransicionar(estado, 'cancelada')).toBe(true);
    }
  });

  it('no manda recordatorios de citas muertas', () => {
    expect(aceptaRecordatorios('confirmada')).toBe(true);
    expect(aceptaRecordatorios('solicitada')).toBe(true);
    expect(aceptaRecordatorios('cancelada')).toBe(false);
    expect(aceptaRecordatorios('reagendada')).toBe(false);
    expect(aceptaRecordatorios('cumplida')).toBe(false);
  });

  it('ningun estado se transiciona a si mismo', () => {
    for (const estado of TODOS) {
      expect(puedeTransicionar(estado, estado)).toBe(false);
    }
  });
});

describe('costo por confirmar (seccion 05)', () => {
  it('marca la cita cuando el proveedor no dio precio', () => {
    expect(costoPorConfirmar(null)).toBe(true);
    expect(costoPorConfirmar(undefined)).toBe(true);
  });

  it('no la marca cuando si lo dio, incluso si es gratis', () => {
    expect(costoPorConfirmar(450)).toBe(false);
    expect(costoPorConfirmar(0)).toBe(false);
  });
});
