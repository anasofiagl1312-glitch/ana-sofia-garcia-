import { describe, expect, it } from 'vitest';
import {
  type DatosAviso,
  type OpcionHorario,
  AvisoIncompleto,
  SinOpcionesDeHorario,
  TEXTO_COSTO_POR_CONFIRMAR,
  asegurarReglaDeContenido,
  avisoConfirmacion,
  datosFaltantes,
  redactarAviso,
} from '../../src/modules/mensajes/contenido.js';
import { PLANTILLAS, renderizar } from '../../src/channels/whatsapp/plantillas.js';
import type { MomentoRecordatorio } from '../../src/domain/agenda.js';
import { instanteDesdeLocal } from '../../src/domain/tiempo.js';

const CDMX = 'America/Mexico_City';

const LOLA: DatosAviso = {
  servicio: 'Baño',
  mascota: 'Lola',
  // 22 de octubre de 2026 es jueves, como en el ejemplo del documento.
  iniciaEn: instanteDesdeLocal('2026-10-22', '11:00', CDMX),
  zona: CDMX,
  proveedor: 'Petco Polanco',
  direccion: 'Av. Presidente Masaryk 275',
  costo: 450,
};

const OPCIONES: OpcionHorario[] = [
  { fecha: '2026-10-22', diaSemana: 4, horaInicio: '10:00', horaFin: '13:00' },
  { fecha: '2026-10-24', diaSemana: 6, horaInicio: '09:00', horaFin: '12:00' },
];

const TODOS_LOS_MOMENTOS: MomentoRecordatorio[] = ['t_21', 't_7', 't_3', 't_0', 'cierre'];

describe('REGLA DE CONTENIDO: los cuatro datos, sin excepcion', () => {
  it('todos los momentos traen servicio, cuando, donde y cuanto', () => {
    for (const momento of TODOS_LOS_MOMENTOS) {
      const aviso = redactarAviso(momento, LOLA, OPCIONES);
      expect(datosFaltantes(aviso.texto, LOLA), `momento ${momento}`).toEqual([]);
    }
  });

  it('la confirmacion tambien los trae', () => {
    expect(datosFaltantes(avisoConfirmacion(LOLA).texto, LOLA)).toEqual([]);
  });

  it('los siguen trayendo cuando el proveedor no dio direccion', () => {
    const sinDireccion = { ...LOLA, direccion: null };
    for (const momento of TODOS_LOS_MOMENTOS) {
      const aviso = redactarAviso(momento, sinDireccion, OPCIONES);
      expect(datosFaltantes(aviso.texto, sinDireccion), `momento ${momento}`).toEqual([]);
      expect(aviso.texto).toContain('Petco Polanco');
    }
  });

  it('cuando no hay precio lo dice, en vez de callarlo (seccion 05)', () => {
    const sinCosto = { ...LOLA, costo: null };
    for (const momento of TODOS_LOS_MOMENTOS) {
      const aviso = redactarAviso(momento, sinCosto, OPCIONES);
      expect(datosFaltantes(aviso.texto, sinCosto), `momento ${momento}`).toEqual([]);
      expect(aviso.texto).toContain(TEXTO_COSTO_POR_CONFIRMAR);
    }
  });

  it('los trae tambien con indicaciones del proveedor', () => {
    const conIndicaciones = { ...LOLA, indicaciones: 'llegar en ayuno y traer transportadora' };
    const aviso = redactarAviso('t_0', conIndicaciones);
    expect(datosFaltantes(aviso.texto, conIndicaciones)).toEqual([]);
    expect(aviso.texto).toContain('llegar en ayuno y traer transportadora');
  });
});

describe('datosFaltantes', () => {
  it('detecta cada dato ausente', () => {
    expect(datosFaltantes('Recordatorio: el 22 de octubre a las 11:00 en Petco Polanco. Costo estimado: $450.', LOLA))
      .toEqual(['servicio']);
    expect(datosFaltantes('Tienes el baño de Lola en Petco Polanco. Costo estimado: $450.', LOLA))
      .toEqual(['cuando']);
    expect(datosFaltantes('El baño el 22 de octubre a las 11:00. Costo estimado: $450.', LOLA))
      .toEqual(['donde']);
    expect(datosFaltantes('El baño el 22 de octubre a las 11:00 en Petco Polanco.', LOLA))
      .toEqual(['cuanto']);
  });

  it('exige fecha Y hora, no una sola', () => {
    const soloFecha = 'El baño de Lola el 22 de octubre en Petco Polanco. Costo estimado: $450.';
    expect(datosFaltantes(soloFecha, LOLA)).toContain('cuando');
    const soloHora = 'El baño de Lola a las 11:00 en Petco Polanco. Costo estimado: $450.';
    expect(datosFaltantes(soloHora, LOLA)).toContain('cuando');
  });

  it('no se deja enganar por un monto que no es el de la cita', () => {
    const otroMonto = 'El baño de Lola el 22 de octubre a las 11:00 en Petco Polanco. Cuesta $999.';
    expect(datosFaltantes(otroMonto, LOLA)).toEqual(['cuanto']);
  });

  it('asegurarReglaDeContenido detiene un aviso incompleto', () => {
    const roto = {
      momento: 't_7' as const,
      texto: 'Recordatorio: mañana.',
      plantilla: 'huella_recordatorio_v1' as const,
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

describe('redaccion de cada momento', () => {
  it('el recordatorio reproduce el ejemplo del documento', () => {
    expect(redactarAviso('t_7', LOLA).texto).toBe(
      'Recordatorio: el jueves 22 de octubre a las 11:00 tienes el baño de Lola ' +
        'en Petco Polanco (Av. Presidente Masaryk 275). Costo estimado: $450. ' +
        '¿Necesitas cambiarla? Responde REAGENDAR.',
    );
  });

  it('la consulta de disponibilidad ofrece opciones numeradas (RF-03)', () => {
    const aviso = redactarAviso('t_21', LOLA, OPCIONES);
    expect(aviso.texto).toContain('1) jueves 22 de octubre, de 10:00 a 13:00');
    expect(aviso.texto).toContain('2) sábado 24 de octubre, de 09:00 a 12:00');
  });

  it('se niega a preguntar disponibilidad sin opciones concretas', () => {
    expect(() => redactarAviso('t_21', LOLA, [])).toThrow(SinOpcionesDeHorario);
  });

  it('el aviso del dia sin indicaciones no las menciona', () => {
    expect(redactarAviso('t_0', LOLA).texto).not.toContain('Indicaciones');
  });

  it('el cierre pide el costo real (RF-21)', () => {
    expect(redactarAviso('cierre', LOLA).texto).toMatch(/cuánto pagaste/i);
  });

  it('agrega el ano solo cuando la cita cae en otro ano', () => {
    expect(redactarAviso('t_7', LOLA).texto).not.toContain('de 2026 a las');
  });
});

describe('el texto y la plantilla aprobada por Meta no se separan', () => {
  it('renderizar la plantilla declarada reproduce el texto, en todos los casos', () => {
    const casos: Array<[string, DatosAviso]> = [
      ['completo', LOLA],
      ['sin direccion', { ...LOLA, direccion: null }],
      ['sin costo', { ...LOLA, costo: null }],
      ['con indicaciones', { ...LOLA, indicaciones: 'traer carnet' }],
    ];

    for (const [nombre, datos] of casos) {
      for (const momento of TODOS_LOS_MOMENTOS) {
        const aviso = redactarAviso(momento, datos, OPCIONES);
        expect(renderizar(PLANTILLAS[aviso.plantilla], aviso.variables), `${nombre} / ${momento}`).toBe(aviso.texto);
      }
      const confirmacion = avisoConfirmacion(datos);
      expect(renderizar(PLANTILLAS[confirmacion.plantilla], confirmacion.variables), `${nombre} / confirmacion`)
        .toBe(confirmacion.texto);
    }
  });

  it('el aviso del dia elige la plantilla segun haya o no indicaciones', () => {
    expect(redactarAviso('t_0', LOLA).plantilla).toBe('huella_aviso_dia_v1');
    expect(redactarAviso('t_0', { ...LOLA, indicaciones: 'traer carnet' }).plantilla)
      .toBe('huella_aviso_dia_indicaciones_v1');
    // Unas indicaciones en blanco no deben elegir la plantilla con variable
    // vacia, que Meta rechazaria.
    expect(redactarAviso('t_0', { ...LOLA, indicaciones: '   ' }).plantilla).toBe('huella_aviso_dia_v1');
  });
});
