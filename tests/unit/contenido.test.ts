import { describe, expect, it } from 'vitest';
import {
  type DatosAviso,
  type OpcionHorario,
  AvisoIncompleto,
  OpcionesDeHorarioInsuficientes,
  TEXTO_COSTO_POR_CONFIRMAR,
  asegurarReglaDeContenido,
  avisoConfirmacion,
  datosFaltantes,
  mesDe,
  nombreDePila,
  redactarAviso,
} from '../../src/modules/mensajes/contenido.js';
import { PLANTILLAS, renderizar } from '../../src/channels/whatsapp/plantillas.js';
import type { MomentoRecordatorio } from '../../src/domain/agenda.js';
import { instanteDesdeLocal } from '../../src/domain/tiempo.js';

const CDMX = 'America/Mexico_City';

const LOLA: DatosAviso = {
  servicio: 'Baño',
  articuloServicio: 'el',
  mascota: 'Lola',
  nombrePila: 'María Fernanda Ruiz',
  // 22 de octubre de 2026 es jueves, como en el ejemplo del documento.
  iniciaEn: instanteDesdeLocal('2026-10-22', '11:00', CDMX),
  zona: CDMX,
  proveedor: 'Petco Polanco',
  direccion: 'Av. Masaryk 275',
  costo: 450,
  mesSiguiente: 'noviembre',
};

const OPCIONES: OpcionHorario[] = [
  { fecha: '2026-10-22', diaSemana: 4, horaInicio: '10:00', horaFin: '13:00' },
  { fecha: '2026-10-24', diaSemana: 6, horaInicio: '09:00', horaFin: '12:00' },
  { fecha: '2026-10-29', diaSemana: 4, horaInicio: '10:00', horaFin: '13:00' },
];

const TODOS: MomentoRecordatorio[] = ['t_21', 'confirmacion', 't_7', 't_3', 't_0', 'cierre'];

/** Las combinaciones de datos opcionales que cambian de plantilla. */
const VARIANTES: Array<[string, DatosAviso]> = [
  ['completo', LOLA],
  ['sin dirección', { ...LOLA, direccion: null }],
  ['sin costo confirmado', { ...LOLA, costo: null }],
  ['sin nombre de pila', { ...LOLA, nombrePila: null }],
  ['con indicaciones', { ...LOLA, indicaciones: 'llegar en ayuno' }],
  ['cita puntual, sin siguiente ciclo', { ...LOLA, mesSiguiente: null }],
  ['servicio femenino', { ...LOLA, servicio: 'Vacunación', articuloServicio: 'la' }],
];

describe('REGLA DE CONTENIDO: los cuatro datos, sin excepción', () => {
  it.each(VARIANTES)('%s: todos los momentos traen servicio, cuándo, dónde y cuánto', (_nombre, datos) => {
    for (const momento of TODOS) {
      const aviso = redactarAviso(momento, datos, OPCIONES);
      expect(datosFaltantes(aviso.texto, datos), `momento ${momento}`).toEqual([]);
    }
  });

  it('cuando no hay precio lo dice, en vez de callarlo (sección 05)', () => {
    const sinCosto = { ...LOLA, costo: null };
    for (const momento of TODOS) {
      const aviso = redactarAviso(momento, sinCosto, OPCIONES);
      expect(aviso.texto, `momento ${momento}`).toContain(TEXTO_COSTO_POR_CONFIRMAR);
      // La línea del costo nunca se omite: el 💲 sigue ahí.
      expect(aviso.texto, `momento ${momento}`).toContain('💲');
    }
  });

  it('sin dirección sigue diciendo dónde, sin dejar una coma colgando', () => {
    const sinDireccion = { ...LOLA, direccion: null };
    for (const momento of TODOS) {
      const aviso = redactarAviso(momento, sinDireccion, OPCIONES);
      expect(aviso.texto, `momento ${momento}`).toContain('Petco Polanco');
      expect(aviso.texto, `momento ${momento}`).not.toMatch(/Petco Polanco,\s*$/m);
    }
  });
});

describe('el copy validado', () => {
  it('T−21 saluda por el nombre de pila y numera las tres opciones', () => {
    expect(redactarAviso('t_21', LOLA, OPCIONES).texto).toBe(
      'Hola María 👋 Ya se acerca el baño de Lola en Petco Polanco, Av. Masaryk 275.\n\n' +
        '¿Qué día te acomoda?\n' +
        '1) jueves 22 de octubre, de 10:00 a 13:00\n' +
        '2) sábado 24 de octubre, de 09:00 a 12:00\n' +
        '3) jueves 29 de octubre, de 10:00 a 13:00\n\n' +
        '💲 $450\n\n' +
        'Contéstame con el número y yo agendo.',
    );
  });

  it('la confirmación abre con la palomita y cierra con el REAGENDAR', () => {
    expect(avisoConfirmacion(LOLA).texto).toBe(
      '✅ Listo, ya quedó.\n\n' +
        'Lola · Baño\n' +
        '📅 jueves 22 de octubre a las 11:00\n' +
        '📍 Petco Polanco, Av. Masaryk 275\n' +
        '💲 $450\n\n' +
        'Yo te vuelvo a escribir una semana antes. Si necesitas moverla, escribe REAGENDAR y yo me encargo.',
    );
  });

  it('T−7 y T−3 llevan el 📌 y el 🐶 del copy', () => {
    expect(redactarAviso('t_7', LOLA).texto).toContain('Recordatorio 📌 Falta una semana para el baño de Lola.');
    expect(redactarAviso('t_3', LOLA).texto).toContain('Faltan 3 días para el baño de Lola 🐶');
  });

  it('el aviso del día abre con la celebración y ofrece el carnet', () => {
    const aviso = redactarAviso('t_0', LOLA);
    expect(aviso.texto.startsWith('¡Hoy es el día! 🎉')).toBe(true);
    expect(aviso.texto).toContain('Si necesitas el carnet, dime y te lo mando.');
  });

  it('el cierre pregunta las dos cositas y anuncia el siguiente ciclo', () => {
    const aviso = redactarAviso('cierre', LOLA);
    expect(aviso.texto).toContain('¿cómo les fue ayer? 🐾');
    expect(aviso.texto).toContain('¿Cuánto acabaste pagando?');
    expect(aviso.texto).toContain('Ya dejé programado el siguiente para noviembre. Yo te busco.');
  });

  it('una cita puntual no promete un siguiente ciclo que no existe', () => {
    const aviso = redactarAviso('cierre', { ...LOLA, mesSiguiente: null });
    expect(aviso.texto).not.toContain('Ya dejé programado');
    expect(aviso.texto).toContain('Cualquier cosa que necesites, aquí ando.');
    expect(aviso.plantilla).toBe('huella_cierre_puntual_v2');
  });

  it('el artículo del servicio viene del catálogo, no de una regla adivinada', () => {
    const femenino = { ...LOLA, servicio: 'Vacunación', articuloServicio: 'la' as const };
    expect(redactarAviso('t_7', femenino).texto).toContain('para la vacunación de Lola');
    expect(redactarAviso('t_7', LOLA).texto).toContain('para el baño de Lola');
  });

  it('las indicaciones vacías no dejan una línea huérfana', () => {
    for (const vacio of [null, '', '   ']) {
      const aviso = redactarAviso('t_0', { ...LOLA, indicaciones: vacio });
      expect(aviso.plantilla, String(vacio)).toBe('huella_aviso_dia_v2');
      expect(aviso.texto, String(vacio)).not.toContain('📋');
      expect(aviso.texto, String(vacio)).not.toMatch(/\n\s*\n\s*\n/);
    }
    expect(redactarAviso('t_0', { ...LOLA, indicaciones: 'traer carnet' }).plantilla)
      .toBe('huella_aviso_dia_indicaciones_v2');
  });
});

describe('nombre de pila', () => {
  it('se queda con el primero', () => {
    expect(nombreDePila('María Fernanda Ruiz')).toBe('María');
    expect(nombreDePila('  Ana  ')).toBe('Ana');
  });

  it('sin nombre no inventa uno: elige la variante que no saluda por nombre', () => {
    expect(nombreDePila(null)).toBeNull();
    expect(nombreDePila('   ')).toBeNull();

    const anonima = { ...LOLA, nombrePila: null };
    expect(redactarAviso('t_21', anonima, OPCIONES).plantilla).toBe('huella_disponibilidad_sin_nombre_v2');
    expect(redactarAviso('t_21', anonima, OPCIONES).texto.startsWith('Hola 👋')).toBe(true);
    expect(redactarAviso('cierre', anonima).plantilla).toBe('huella_cierre_sin_nombre_v2');
  });
});

describe('datosFaltantes', () => {
  it('detecta cada dato ausente', () => {
    expect(datosFaltantes('El 22 de octubre a las 11:00 en Petco Polanco. 💲 $450', LOLA)).toEqual(['servicio']);
    expect(datosFaltantes('El baño de Lola en Petco Polanco. 💲 $450', LOLA)).toEqual(['cuando']);
    expect(datosFaltantes('El baño el 22 de octubre a las 11:00. 💲 $450', LOLA)).toEqual(['donde']);
    expect(datosFaltantes('El baño el 22 de octubre a las 11:00 en Petco Polanco.', LOLA)).toEqual(['cuanto']);
  });

  it('acepta «hoy» como fecha, porque el aviso del día no obliga a buscar nada', () => {
    const texto = 'Lola tiene su baño hoy a las 11:00.\n📍 Petco Polanco\n💲 $450';
    expect(datosFaltantes(texto, LOLA)).toEqual([]);
  });

  it('exige hora aunque diga «hoy»', () => {
    expect(datosFaltantes('Lola tiene su baño hoy en Petco Polanco. 💲 $450', LOLA)).toContain('cuando');
  });

  it('no se deja engañar por un monto que no es el de la cita', () => {
    expect(datosFaltantes('El baño de Lola el 22 de octubre a las 11:00 en Petco Polanco. 💲 $999', LOLA))
      .toEqual(['cuanto']);
  });

  it('asegurarReglaDeContenido detiene un aviso incompleto', () => {
    const roto = {
      momento: 't_7' as const,
      texto: 'Recordatorio: mañana.',
      plantilla: 'huella_recordatorio_7_v2' as const,
      variables: [],
    };
    expect(() => asegurarReglaDeContenido(roto, LOLA)).toThrow(AvisoIncompleto);
    try {
      asegurarReglaDeContenido(roto, LOLA);
    } catch (error) {
      expect((error as AvisoIncompleto).faltantes).toEqual(['servicio', 'cuando', 'donde', 'cuanto']);
    }
  });
});

describe('opciones de horario de T−21', () => {
  it('exige exactamente tres, porque el copy tiene tres renglones numerados', () => {
    expect(() => redactarAviso('t_21', LOLA, [])).toThrow(OpcionesDeHorarioInsuficientes);
    expect(() => redactarAviso('t_21', LOLA, OPCIONES.slice(0, 2))).toThrow(OpcionesDeHorarioInsuficientes);
    expect(() => redactarAviso('t_21', LOLA, [...OPCIONES, OPCIONES[0]!])).toThrow(OpcionesDeHorarioInsuficientes);
  });
});

describe('el texto y la plantilla aprobada por Meta no se separan', () => {
  it.each(VARIANTES)('%s: renderizar la plantilla declarada reproduce el texto', (_nombre, datos) => {
    for (const momento of TODOS) {
      const aviso = redactarAviso(momento, datos, OPCIONES);
      expect(renderizar(PLANTILLAS[aviso.plantilla], aviso.variables), `${_nombre} / ${momento}`)
        .toBe(aviso.texto);
    }
  });

  it('ningún valor de variable lleva saltos de línea, que Meta rechaza', () => {
    for (const [, datos] of VARIANTES) {
      for (const momento of TODOS) {
        const aviso = redactarAviso(momento, datos, OPCIONES);
        for (const [i, valor] of aviso.variables.entries()) {
          expect(/[\n\r\t]/.test(valor), `${aviso.plantilla} {{${i + 1}}}`).toBe(false);
          expect(valor.trim(), `${aviso.plantilla} {{${i + 1}}}`).not.toBe('');
        }
      }
    }
  });
});

describe('mesDe', () => {
  it('da el nombre del mes de una fecha local', () => {
    expect(mesDe('2026-11-22')).toBe('noviembre');
    expect(mesDe('2026-01-05')).toBe('enero');
  });
});
