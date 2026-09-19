/**
 * Leer el carnet: interfaz y adaptadores.
 *
 * Mismo trato que el canal de WhatsApp: el sistema habla contra esta interfaz y
 * quien de verdad lee la foto vive detrás de un adaptador. Hoy es Claude;
 * cambiarlo por otro modelo, por un OCR clásico o por una persona capturando a
 * mano es escribir otro adaptador, no tocar lo demás.
 *
 * El adaptador sólo LEE. No decide qué es válido ni qué se guarda: eso está en
 * `src/domain/carnet.ts`, que corre igual con cualquier lector y tiene sus
 * propias pruebas. Un lector que se equivoca de fecha no puede meter un dato
 * malo a la base sin pasar por ahí.
 */
import type { LecturaCruda } from '../../domain/carnet.js';

export interface DocumentoParaLeer {
  /** El archivo, ya descifrado. */
  contenido: Buffer;
  /** image/jpeg, image/png, application/pdf... */
  tipoMime: string;
}

export interface ResultadoDeLectura {
  lectura: LecturaCruda;
  /** Qué leyó el carnet, para poder auditar y para saber qué se está pagando. */
  procedencia: {
    lector: string;
    modelo: string | null;
    tokensEntrada: number | null;
    tokensSalida: number | null;
    /** Milisegundos que tardó, que es lo que la clienta espera mirando la pantalla. */
    ms: number;
  };
}

export interface LectorDeCarnet {
  /** Cómo se llama, para la bitácora y para que la interfaz sepa si hay lector. */
  readonly nombre: string;
  /** `false` cuando no hay con qué leer: la interfaz ofrece captura a mano. */
  readonly disponible: boolean;
  leer(documento: DocumentoParaLeer): Promise<ResultadoDeLectura>;
}

export class CarnetIlegible extends Error {}

export const TIPOS_QUE_SE_PUEDEN_LEER = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/**
 * HEIC es lo que sale de un iPhone por defecto y Claude no lo acepta como
 * imagen. Se guarda igual (el documento sirve para que la clienta lo consulte),
 * pero no se intenta leer: mejor decirlo que mandar una petición que falla.
 */
export function sePuedeLeer(tipoMime: string): boolean {
  return (TIPOS_QUE_SE_PUEDEN_LEER as readonly string[]).includes(tipoMime);
}

export interface OpcionesDeLector {
  driver: 'claude' | 'ninguno';
  apiKey?: string | undefined;
  modelo?: string | undefined;
}

/**
 * El lector que no lee.
 *
 * No es un adaptador de mentiras para pruebas: es el modo normal del piloto
 * cuando no hay llave de API. La interfaz pregunta `disponible` y ofrece
 * capturar a mano, en vez de enseñar un botón que siempre falla.
 */
export class SinLector implements LectorDeCarnet {
  readonly nombre = 'ninguno';
  readonly disponible = false;

  async leer(): Promise<ResultadoDeLectura> {
    throw new CarnetIlegible(
      'Ahorita no puedo leer el carnet solo. Captura las vacunas a mano; la foto ya quedó guardada.',
    );
  }
}

export async function crearLectorDeCarnet(opciones: OpcionesDeLector): Promise<LectorDeCarnet> {
  if (opciones.driver === 'ninguno' || !opciones.apiKey) return new SinLector();

  // Se importa aquí y no arriba para que quien corra el piloto sin llave no
  // cargue el SDK ni necesite tenerlo resuelto.
  const { LectorClaude } = await import('./claude.js');
  return new LectorClaude({ apiKey: opciones.apiKey, modelo: opciones.modelo });
}
