/**
 * Servidor HTTP.
 *
 * La conversacion por WhatsApp es el canal principal del producto (RF-25), pero
 * detras de ella hay una API: el flujo conversacional, el panel interno y la
 * app de Fase 3 hablan todos contra estas mismas rutas. Tener la logica en
 * modulos y las rutas como una capa delgada es lo que permite que la app movil
 * no obligue a reescribir nada.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import estaticos from '@fastify/static';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { ZodError } from 'zod';
import type { Config } from '../config/index.js';
import type { CanalWhatsApp } from '../channels/whatsapp/index.js';
import type { Almacen } from '../modules/almacenamiento/index.js';
import { DocumentoRechazado } from '../modules/almacenamiento/index.js';
import type { Pasarela } from '../modules/suscripcion/servicio.js';
import { usuariaDeSesion } from '../modules/auth/servicio.js';
import { CodigoInvalido, DemasiadasSolicitudes } from '../modules/auth/servicio.js';
import { type Operador, SinPermiso } from '../modules/panel/servicio.js';
import { MascotaNoEncontrada } from '../modules/carnet/servicio.js';
import { TransicionInvalida } from '../domain/citas.js';
import { TelefonoInvalido } from '../lib/telefono.js';
import { CelularYaRegistrado } from '../modules/panel/alta.js';
import { AvisoIncompleto } from '../modules/mensajes/contenido.js';
import { registrarRutasAuth } from './rutas/auth.js';
import { registrarRutasMascotas } from './rutas/mascotas.js';
import { registrarRutasAgenda } from './rutas/agenda.js';
import { registrarRutasPanel } from './rutas/panel.js';
import { registrarRutasWebhooks } from './rutas/webhooks.js';

export interface Servicios {
  pool: pg.Pool;
  config: Config;
  whatsapp: CanalWhatsApp;
  almacen: Almacen;
  pasarela: Pasarela;
}

declare module 'fastify' {
  interface FastifyRequest {
    usuariaId?: string;
    operador?: Operador;
  }
}

/** Version vigente del aviso de privacidad (seccion 09). */
export const VERSION_AVISO_PRIVACIDAD = '2026-09-01';

export async function crearServidor(servicios: Servicios): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: servicios.config.nivelLog },
    // El carnet fotografiado puede ser pesado; el limite fino lo pone
    // validarDocumento, aqui solo se acota lo que se acepta leer.
    bodyLimit: 20 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 16 * 1024 * 1024, files: 1 } });

  /**
   * Interfaz del panel interno, en /panel.
   *
   * Son archivos estáticos que hablan con /panel/api. Sin compilador ni paso de
   * construcción: para un panel que usan tres personas, una cadena de
   * herramientas de frontend cuesta más de lo que ahorra, y así se puede editar
   * el CSS en el servidor y recargar.
   *
   * `index: false` y sin listado de directorio: se sirve solo lo que existe.
   */
  await app.register(estaticos, {
    root: fileURLToPath(new URL('../../public', import.meta.url)),
    prefix: '/panel/',
    index: false,
    list: false,
  });

  // /panel y /panel/ entregan la interfaz.
  for (const ruta of ['/panel', '/panel/']) {
    app.get(ruta, async (_peticion, respuesta) => respuesta.sendFile('index.html'));
  }

  /**
   * Autenticacion de la usuaria por token de sesion.
   *
   * Se aplica con `preHandler` en cada grupo de rutas que lo necesita, no
   * globalmente: asi una ruta nueva sin proteccion se nota, en vez de quedar
   * protegida por accidente y descubrirse al reves.
   */
  app.decorate('autenticarUsuaria', async (peticion: FastifyRequest) => {
    const token = tokenDe(peticion);
    if (!token) throw Object.assign(new Error('Falta el token de sesión.'), { statusCode: 401 });
    const usuariaId = await usuariaDeSesion(servicios.pool, token);
    if (!usuariaId) throw Object.assign(new Error('Sesión inválida o vencida.'), { statusCode: 401 });
    peticion.usuariaId = usuariaId;
  });

  app.setErrorHandler((errorCrudo, peticion, respuesta) => {
    const error = errorCrudo as Error & { statusCode?: number };
    const estado = mapearError(error);
    if (estado >= 500) peticion.log.error({ error }, 'error no controlado');

    if (error instanceof ZodError) {
      return respuesta.status(400).send({
        error: 'datos_invalidos',
        // Los mensajes van en espanol (RNF-01) y apuntan al campo concreto.
        detalles: error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      });
    }

    return respuesta.status(estado).send({
      error: nombreDeError(error),
      mensaje: estado >= 500 ? 'Ocurrió un error inesperado.' : error.message,
    });
  });

  app.get('/salud', async () => {
    await servicios.pool.query('SELECT 1');
    return { estado: 'ok' };
  });

  await registrarRutasAuth(app, servicios);
  await registrarRutasMascotas(app, servicios);
  await registrarRutasAgenda(app, servicios);
  await registrarRutasPanel(app, servicios);
  await registrarRutasWebhooks(app, servicios);

  return app;
}

function tokenDe(peticion: FastifyRequest): string | null {
  const cabecera = peticion.headers.authorization;
  if (!cabecera) return null;
  const [esquema, valor] = cabecera.split(' ');
  return esquema?.toLowerCase() === 'bearer' && valor ? valor : null;
}

function mapearError(error: Error & { statusCode?: number }): number {
  if (error.statusCode) return error.statusCode;
  if (error instanceof ZodError) return 400;
  if (error instanceof TelefonoInvalido) return 400;
  if (error instanceof DocumentoRechazado) return 400;
  if (error instanceof TransicionInvalida) return 409;
  if (error instanceof CelularYaRegistrado) return 409;
  if (error instanceof AvisoIncompleto) return 500;
  if (error instanceof CodigoInvalido) return 401;
  if (error instanceof DemasiadasSolicitudes) return 429;
  if (error instanceof SinPermiso) return 403;
  if (error instanceof MascotaNoEncontrada) return 404;
  return 500;
}

function nombreDeError(error: Error): string {
  const nombres: Record<string, string> = {
    TelefonoInvalido: 'telefono_invalido',
    DocumentoRechazado: 'documento_rechazado',
    TransicionInvalida: 'transicion_invalida',
    CelularYaRegistrado: 'celular_ya_registrado',
    CodigoInvalido: 'codigo_invalido',
    DemasiadasSolicitudes: 'demasiadas_solicitudes',
    SinPermiso: 'sin_permiso',
    MascotaNoEncontrada: 'no_encontrado',
    AvisoIncompleto: 'aviso_incompleto',
  };
  return nombres[error.name] ?? 'error';
}

declare module 'fastify' {
  interface FastifyInstance {
    autenticarUsuaria: (peticion: FastifyRequest) => Promise<void>;
  }
}
