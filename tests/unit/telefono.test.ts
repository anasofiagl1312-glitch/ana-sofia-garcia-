import { describe, expect, it } from 'vitest';
import { TelefonoInvalido, formatearTelefono, normalizarTelefono, normalizarTelefonoOpcional } from '../../src/lib/telefono.js';
import { claveDedup, normalizarNombre, requiereRevision } from '../../src/modules/proveedores/dedup.js';

describe('normalizarTelefono', () => {
  it('acepta las formas en que la gente escribe un celular mexicano', () => {
    for (const entrada of [
      '5512345678',
      '55 1234 5678',
      '(55) 1234-5678',
      '+52 55 1234 5678',
      '+525512345678',
      '52 55 1234 5678',
      '00525512345678', // prefijo de marcación internacional
    ]) {
      expect(normalizarTelefono(entrada), entrada).toBe('+525512345678');
    }
  });

  it('unifica el "1" de celular que devuelve WhatsApp', () => {
    // Si no se unificara, la misma persona existiria dos veces.
    expect(normalizarTelefono('+521 55 1234 5678')).toBe('+525512345678');
    expect(normalizarTelefono('5215512345678')).toBe('+525512345678');
  });

  it('acepta el viejo prefijo 044 de celular', () => {
    expect(normalizarTelefono('044 55 1234 5678')).toBe('+525512345678');
    expect(normalizarTelefono('045 55 1234 5678')).toBe('+525512345678');
  });

  it('conserva numeros de otros paises', () => {
    expect(normalizarTelefono('+1 415 555 0132')).toBe('+14155550132');
  });

  it('rechaza lo que no es un telefono', () => {
    for (const malo of ['', '   ', 'no tengo', '123', 'abc-def']) {
      expect(() => normalizarTelefono(malo), malo).toThrow(TelefonoInvalido);
    }
  });

  it('la version opcional devuelve null en vez de lanzar', () => {
    expect(normalizarTelefonoOpcional(null)).toBeNull();
    expect(normalizarTelefonoOpcional('')).toBeNull();
    expect(normalizarTelefonoOpcional('no tengo')).toBeNull();
    expect(normalizarTelefonoOpcional('5512345678')).toBe('+525512345678');
  });

  it('formatea para mostrarlo en el panel', () => {
    expect(formatearTelefono('+525512345678')).toBe('55 1234 5678');
  });
});

describe('identidad del proveedor compartido (pregunta abierta 4)', () => {
  it('el telefono manda: el mismo negocio escrito distinto es una sola fila', () => {
    const a = claveDedup({ negocio: 'Petco', sucursal: 'Polanco', telefono: '55 1122 3344' });
    const b = claveDedup({ negocio: 'PETCO Masaryk', sucursal: 'polanco', telefono: '+525511223344' });
    expect(a).toBe(b);
  });

  it('el whatsapp sirve cuando no hay telefono fijo', () => {
    expect(claveDedup({ negocio: 'Estética Kiara', whatsapp: '5511223344' })).toBe('tel:+525511223344');
  });

  it('sin telefono cae a nombre y sucursal normalizados', () => {
    const a = claveDedup({ negocio: 'Estética Kiara', sucursal: 'Del Valle' });
    const b = claveDedup({ negocio: '  estetica   kiara  ', sucursal: 'DEL VALLE' });
    expect(a).toBe(b);
    expect(a).toBe('nom:estetica-kiara|del-valle');
  });

  it('dos sucursales del mismo negocio NO son el mismo proveedor', () => {
    const polanco = claveDedup({ negocio: 'Petco', sucursal: 'Polanco' });
    const coyoacan = claveDedup({ negocio: 'Petco', sucursal: 'Coyoacán' });
    expect(polanco).not.toBe(coyoacan);
  });

  it('marca para revision al proveedor que solo tiene nombre', () => {
    expect(requiereRevision({ negocio: 'Estética Kiara' })).toBe(true);
    expect(requiereRevision({ negocio: 'Estética Kiara', telefono: '5511223344' })).toBe(false);
  });

  it('exige al menos un nombre de negocio', () => {
    expect(() => claveDedup({ negocio: '   ' })).toThrow();
  });

  it('normalizarNombre quita acentos y signos', () => {
    expect(normalizarNombre('Veterinaria "El Pequeño" S.A. de C.V.')).toBe('veterinaria-el-pequeno-s-a-de-c-v');
  });
});
