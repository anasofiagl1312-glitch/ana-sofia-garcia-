/**
 * El canal que lee el carnet.
 *
 * Lo que se prueba aquí no es que el modelo lea bien —eso no se puede probar
 * sin una foto y sin gastar— sino lo otro, que es lo que de verdad se rompe:
 * que cada forma de fallar termine en un mensaje que le diga a la clienta qué
 * hacer, y nunca en una pantalla rota o en una propuesta vacía que parezca un
 * carnet en blanco.
 */
import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  CarnetIlegible,
  crearLectorDeCarnet,
  sePuedeLeer,
  SinLector,
} from '../../src/channels/carnet/index.js';
import { LectorClaude, MODELO_POR_DEFECTO } from '../../src/channels/carnet/claude.js';

const CARNET_VACIO = {
  mascota: { nombre: 'Canela', especie: 'canino', raza: null, sexo: null,
             nacimiento: null, pesoKg: null, esterilizada: null },
  aplicaciones: [],
  veterinaria: { negocio: null, direccion: null, telefono: null },
  camposDudosos: [],
  notas: null,
};

/** Un cliente de Anthropic de mentiras: contesta lo que le digan, sin red. */
function clienteFalso(respuesta: unknown, capturar?: (peticion: never) => void) {
  return {
    messages: {
      parse: async (peticion: never) => {
        capturar?.(peticion);
        if (respuesta instanceof Error) throw respuesta;
        return respuesta;
      },
    },
  } as unknown as Anthropic;
}

function lectorCon(respuesta: unknown, capturar?: (peticion: never) => void) {
  return new LectorClaude({ apiKey: 'de-mentiras', cliente: clienteFalso(respuesta, capturar) });
}

const FOTO = { contenido: Buffer.from('una foto'), tipoMime: 'image/jpeg' };

describe('qué archivos se pueden leer', () => {
  it('acepta las fotos y el PDF', () => {
    for (const tipo of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(sePuedeLeer(tipo), tipo).toBe(true);
    }
  });

  it('no intenta con HEIC, que es lo que sale de un iPhone', () => {
    // El documento se guarda igual: lo que no se hace es mandar una petición
    // que se sabe que va a fallar y cobrar el intento.
    expect(sePuedeLeer('image/heic')).toBe(false);
  });

  it('un HEIC no revienta: dice que se capture a mano', async () => {
    const lector = lectorCon({ stop_reason: 'end_turn', parsed_output: CARNET_VACIO });

    await expect(lector.leer({ contenido: Buffer.from('x'), tipoMime: 'image/heic' }))
      .rejects.toThrow(CarnetIlegible);
  });
});

describe('cuando no hay con qué leer', () => {
  it('sin llave de API, el lector dice que no está disponible', async () => {
    const lector = await crearLectorDeCarnet({ driver: 'claude', apiKey: undefined });

    expect(lector).toBeInstanceOf(SinLector);
    expect(lector.disponible).toBe(false);
  });

  it('el driver "ninguno" tampoco lee, aunque haya llave', async () => {
    const lector = await crearLectorDeCarnet({ driver: 'ninguno', apiKey: 'sk-de-mentiras' });

    expect(lector.disponible).toBe(false);
  });

  it('si aun así lo llaman, el mensaje dice qué hacer', async () => {
    // Que `disponible` sea false no impide que alguien llame a leer(): el
    // error tiene que servirle a la clienta, no sólo a quien lee el log.
    await expect(new SinLector().leer()).rejects.toThrow(/a mano/i);
  });
});

describe('lo que Claude contesta', () => {
  it('devuelve lo leído y de dónde salió, para poder auditar el gasto', async () => {
    const lector = lectorCon({
      stop_reason: 'end_turn',
      parsed_output: CARNET_VACIO,
      model: 'claude-opus-5',
      usage: { input_tokens: 1500, output_tokens: 800 },
    });

    const r = await lector.leer(FOTO);

    expect(r.lectura.mascota.nombre).toBe('Canela');
    expect(r.procedencia).toMatchObject({
      lector: 'claude', modelo: 'claude-opus-5',
      tokensEntrada: 1500, tokensSalida: 800,
    });
    expect(r.procedencia.ms).toBeGreaterThanOrEqual(0);
  });

  it('usa Opus 5 si nadie dice otra cosa', async () => {
    let peticion: Record<string, unknown> | undefined;
    const lector = lectorCon(
      { stop_reason: 'end_turn', parsed_output: CARNET_VACIO },
      (p) => { peticion = p as Record<string, unknown>; },
    );

    await lector.leer(FOTO);

    expect(peticion?.['model']).toBe(MODELO_POR_DEFECTO);
  });

  it('manda la foto como imagen y el PDF como documento', async () => {
    // Mandar un PDF en un bloque de imagen es un 400, y el mensaje que devuelve
    // no dice que el problema fue el tipo de bloque.
    const bloqueDe = async (tipoMime: string) => {
      let peticion: { messages: Array<{ content: Array<{ type: string }> }> } | undefined;
      const lector = lectorCon(
        { stop_reason: 'end_turn', parsed_output: CARNET_VACIO },
        (p) => { peticion = p as never; },
      );
      await lector.leer({ contenido: Buffer.from('x'), tipoMime });
      return peticion!.messages[0]!.content[0]!.type;
    };

    expect(await bloqueDe('image/png')).toBe('image');
    expect(await bloqueDe('application/pdf')).toBe('document');
  });

  it('una respuesta rechazada no se confunde con un carnet en blanco', async () => {
    // Viene con HTTP 200 y sin contenido. Sin revisar stop_reason, la pantalla
    // diría "no encontré nada en tu carnet", que es mentira.
    const lector = lectorCon({ stop_reason: 'refusal', parsed_output: null });

    await expect(lector.leer(FOTO)).rejects.toThrow(CarnetIlegible);
  });

  it('un carnet más largo de lo que cabe pide subirlo por páginas', async () => {
    const lector = lectorCon({ stop_reason: 'max_tokens', parsed_output: null });

    await expect(lector.leer(FOTO)).rejects.toThrow(/p[áa]gina/i);
  });

  it('si no se pudo armar la respuesta, se captura a mano', async () => {
    const lector = lectorCon({ stop_reason: 'end_turn', parsed_output: null });

    await expect(lector.leer(FOTO)).rejects.toThrow(CarnetIlegible);
  });
});

describe('los errores del SDK, traducidos', () => {
  const comoError = (Clase: new (...a: never[]) => Error, mensaje: string) =>
    Object.assign(Object.create(Clase.prototype) as Error, { message: mensaje });

  it('una llave mal puesta se distingue de una foto que no se pudo leer', async () => {
    // Quien opera el piloto necesita distinguirlas: una se arregla en el .env,
    // la otra volviendo a tomar la foto.
    const lector = lectorCon(comoError(Anthropic.AuthenticationError, 'invalid x-api-key'));

    await expect(lector.leer(FOTO)).rejects.toThrow(/llave/i);
  });

  it('el límite de peticiones dice que espere un minuto', async () => {
    const lector = lectorCon(comoError(Anthropic.RateLimitError, 'rate limited'));

    await expect(lector.leer(FOTO)).rejects.toThrow(/minuto/i);
  });

  it('un archivo que el API rechaza pide una foto más ligera', async () => {
    const lector = lectorCon(comoError(Anthropic.BadRequestError, 'image too large'));

    await expect(lector.leer(FOTO)).rejects.toThrow(/ligera/i);
  });

  it('todos terminan en CarnetIlegible, que es lo que la ruta sabe manejar', async () => {
    for (const Clase of [Anthropic.AuthenticationError, Anthropic.RateLimitError,
                         Anthropic.BadRequestError, Anthropic.InternalServerError]) {
      const lector = lectorCon(comoError(Clase, 'x'));
      await expect(lector.leer(FOTO), Clase.name).rejects.toThrow(CarnetIlegible);
    }
  });

  it('un error que no es del SDK se deja pasar tal cual', async () => {
    // Taparlo con "captura a mano" escondería una falla de programación.
    const lector = lectorCon(new TypeError('algo se programó mal'));

    await expect(lector.leer(FOTO)).rejects.toThrow(TypeError);
  });
});
