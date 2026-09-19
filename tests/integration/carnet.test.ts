/**
 * Subir el carnet, leerlo y guardar lo que la clienta confirma.
 *
 * Se prueba por HTTP y contra la base real, con un lector controlado en vez de
 * Claude: lo que hay que demostrar no es que el modelo lea bien —eso depende de
 * la foto— sino que **nada de lo leído llega a la base sin que una persona lo
 * apruebe**, y que cuando la lectura falla la clienta puede seguir a mano.
 */
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { crearMascota, crearUsuaria, limpiar, prepararBase } from '../ayuda/db.js';
import { crearServidor } from '../../src/http/servidor.js';
import { cargarConfig } from '../../src/config/index.js';
import { crearCanalWhatsApp } from '../../src/channels/whatsapp/index.js';
import { AlmacenEnMemoria, llaveDesdeBase64 } from '../../src/modules/almacenamiento/index.js';
import { PasarelaFalsa } from '../../src/modules/suscripcion/servicio.js';
import {
  CarnetIlegible,
  type DocumentoParaLeer,
  type LectorDeCarnet,
  type ResultadoDeLectura,
  SinLector,
} from '../../src/channels/carnet/index.js';
import type { LecturaCruda } from '../../src/domain/carnet.js';
import { crearSesion } from '../../src/modules/auth/servicio.js';

/** Un lector que devuelve lo que la prueba le diga, y cuenta cuántas veces leyó. */
class LectorDeMentiras implements LectorDeCarnet {
  readonly nombre = 'de-mentiras';
  readonly disponible = true;
  lecturas = 0;
  siguiente: LecturaCruda | Error;

  constructor(siguiente: LecturaCruda | Error) {
    this.siguiente = siguiente;
  }

  async leer(_documento: DocumentoParaLeer): Promise<ResultadoDeLectura> {
    this.lecturas += 1;
    if (this.siguiente instanceof Error) throw this.siguiente;
    return {
      lectura: this.siguiente,
      procedencia: { lector: this.nombre, modelo: 'de-mentiras-1', tokensEntrada: 100, tokensSalida: 50, ms: 12 },
    };
  }
}

const CARNET_DE_CANELA: LecturaCruda = {
  mascota: {
    nombre: 'Canela', especie: 'Canino', raza: 'Schnauzer', sexo: 'H',
    nacimiento: '2021', pesoKg: 8.5, esterilizada: true,
  },
  aplicaciones: [
    { producto: 'Rabia', marca: 'Nobivac', lote: 'A-4471', fechaAplicacion: '10/03/2026',
      fechaRefuerzo: '10/03/2027', veterinario: 'Dra. Martínez', cedulaProfesional: '1234567' },
    { producto: 'Quíntuple', marca: null, lote: null, fechaAplicacion: '02/11/2025',
      fechaRefuerzo: null, veterinario: null, cedulaProfesional: null },
    // Un renglón sin fecha: existe en el carnet pero no se puede guardar.
    { producto: 'Desparasitación', marca: null, lote: null, fechaAplicacion: null,
      fechaRefuerzo: null, veterinario: null, cedulaProfesional: null },
  ],
  veterinaria: { negocio: 'Veterinaria San Ángel', direccion: 'Av. Revolución 1877', telefono: '(55) 3344-5566' },
  camposDudosos: ['aplicaciones.0.lote'],
  notas: 'La última página salió movida.',
};

let pool: pg.Pool;
let app: FastifyInstance;
let lector: LectorDeMentiras;

beforeAll(async () => {
  pool = await prepararBase();
  lector = new LectorDeMentiras(CARNET_DE_CANELA);
  app = await crearServidor({
    pool,
    config: cargarConfig(),
    whatsapp: crearCanalWhatsApp({ driver: 'fake' }),
    almacen: new AlmacenEnMemoria(llaveDesdeBase64(randomBytes(32).toString('base64'))),
    pasarela: new PasarelaFalsa(),
    lectorDeCarnet: lector,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await limpiar(pool);
  lector.lecturas = 0;
  lector.siguiente = CARNET_DE_CANELA;
});

async function comoClienta() {
  const usuaria = await crearUsuaria(pool, { nombre: 'Ana Sofía León' });
  const mascotaId = await crearMascota(pool, usuaria.id, { nombre: 'Canela' });
  const sesion = await crearSesion(pool, usuaria.id);
  return { usuaria, mascota: { id: mascotaId }, sesion };
}

function pedir(sesion: string, url: string, opciones: { method?: string; payload?: unknown } = {}) {
  return app.inject({
    method: (opciones.method ?? 'GET') as 'GET',
    url,
    headers: { authorization: `Bearer ${sesion}` },
    ...(opciones.payload ? { payload: opciones.payload as object } : {}),
  });
}

/** Sube una foto de carnet y devuelve su id. */
async function subirCarnet(sesion: string, mascotaId: string, tipoMime = 'image/jpeg') {
  const frontera = '----huella';
  const cuerpo = Buffer.concat([
    Buffer.from(`--${frontera}\r\nContent-Disposition: form-data; name="tipo"\r\n\r\ncarnet\r\n`),
    Buffer.from(
      `--${frontera}\r\nContent-Disposition: form-data; name="archivo"; filename="carnet.jpg"\r\n` +
        `Content-Type: ${tipoMime}\r\n\r\n`,
    ),
    Buffer.from('una foto del carnet'),
    Buffer.from(`\r\n--${frontera}--\r\n`),
  ]);

  const r = await app.inject({
    method: 'POST',
    url: `/mascotas/${mascotaId}/documentos`,
    headers: { authorization: `Bearer ${sesion}`, 'content-type': `multipart/form-data; boundary=${frontera}` },
    payload: cuerpo,
  });
  expect(r.statusCode, r.body).toBe(201);
  return JSON.parse(r.body).id as string;
}

describe('leer el carnet', () => {
  it('propone lo que dice, con las fechas de México bien entendidas', async () => {
    const { mascota, sesion } = await comoClienta();
    const documentoId = await subirCarnet(sesion, mascota.id);

    const r = await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' });

    expect(r.statusCode, r.body).toBe(200);
    const { propuesta } = JSON.parse(r.body);

    expect(propuesta.mascota).toMatchObject({
      nombre: 'Canela', especie: 'perro', sexo: 'hembra',
      nacimiento: '2021-01-01', nacimientoPrecision: 'anio',
    });
    // "10/03/2026" es 10 de marzo, no 3 de octubre.
    expect(propuesta.aplicaciones[0]).toMatchObject({
      producto: 'Rabia', fechaAplicacion: '2026-03-10', fechaRefuerzo: '2027-03-10',
    });
    expect(propuesta.veterinaria).toMatchObject({ negocio: 'Veterinaria San Ángel', telefono: '5533445566' });
  });

  it('leer NO guarda nada: la mascota sigue igual hasta que ella confirme', async () => {
    // Es la prueba que protege la decisión de todo el diseño. Si esto se
    // rompiera, una foto borrosa pasaría a ser el expediente de la mascota.
    const { mascota, sesion } = await comoClienta();
    const documentoId = await subirCarnet(sesion, mascota.id);

    await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' });

    const { rows } = await pool.query(
      `SELECT raza, sexo, nacimiento,
              (SELECT count(*)::int FROM aplicacion WHERE mascota_id = $1) AS vacunas
         FROM mascota WHERE id = $1`,
      [mascota.id],
    );
    expect(rows[0]).toMatchObject({ raza: null, sexo: 'desconocido', nacimiento: null, vacunas: 0 });
  });

  it('el renglón sin fecha se descarta diciendo de cuál era', async () => {
    const { mascota, sesion } = await comoClienta();
    const documentoId = await subirCarnet(sesion, mascota.id);

    const { propuesta } = JSON.parse(
      (await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' })).body,
    );

    expect(propuesta.aplicaciones).toHaveLength(2);
    expect(propuesta.descartados).toContainEqual(
      expect.objectContaining({ porque: 'No se lee la fecha de Desparasitación.' }),
    );
  });

  it('leer dos veces no cobra dos veces', async () => {
    const { mascota, sesion } = await comoClienta();
    const documentoId = await subirCarnet(sesion, mascota.id);

    await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' });
    const segunda = await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' });

    expect(lector.lecturas).toBe(1);
    expect(JSON.parse(segunda.body).deLaMemoria).toBe(true);
  });

  it('pero se puede forzar cuando la foto salió mal', async () => {
    const { mascota, sesion } = await comoClienta();
    const documentoId = await subirCarnet(sesion, mascota.id);

    await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' });
    await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST', payload: { forzar: true } });

    expect(lector.lecturas).toBe(2);
  });

  it('deja rastro de lo que costó, sin guardar el contenido del carnet', async () => {
    // RNF-06: el carnet trae nombre, dirección y cédula profesional. Va cifrado
    // junto al archivo, nunca en una columna de la base.
    const { mascota, sesion } = await comoClienta();
    const documentoId = await subirCarnet(sesion, mascota.id);

    await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' });

    const { rows } = await pool.query(
      `SELECT lector, lector_modelo, lector_tokens, lectura_datos, leido_en FROM documento WHERE id = $1`,
      [documentoId],
    );
    expect(rows[0]).toMatchObject({ lector: 'de-mentiras', lector_modelo: 'de-mentiras-1', lector_tokens: 150 });
    expect(rows[0].lectura_datos).toBeGreaterThan(0);
    expect(rows[0].leido_en).not.toBeNull();
  });

  it('un carnet ilegible es 422, no una falla del servidor', async () => {
    // La diferencia importa: con 422 la pantalla ofrece capturar a mano; con
    // 500 enseña "algo salió mal" y la clienta abandona el alta.
    const { mascota, sesion } = await comoClienta();
    const documentoId = await subirCarnet(sesion, mascota.id);
    lector.siguiente = new CarnetIlegible('La foto salió muy oscura.');

    const r = await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' });

    expect(r.statusCode).toBe(422);
    expect(JSON.parse(r.body).mensaje).toContain('oscura');
  });

  it('no se puede leer el carnet de otra clienta', async () => {
    const mia = await comoClienta();
    const ajena = await comoClienta();
    const documentoId = await subirCarnet(ajena.sesion, ajena.mascota.id);

    expect((await pedir(mia.sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' })).statusCode).toBe(404);
  });
});

describe('cuando no hay lector', () => {
  it('lo dice con 422 y la foto queda guardada igual', async () => {
    const sinLector = await crearServidor({
      pool,
      config: cargarConfig(),
      whatsapp: crearCanalWhatsApp({ driver: 'fake' }),
      almacen: new AlmacenEnMemoria(llaveDesdeBase64(randomBytes(32).toString('base64'))),
      pasarela: new PasarelaFalsa(),
      lectorDeCarnet: new SinLector(),
    });
    await sinLector.ready();

    try {
      const usuaria = await crearUsuaria(pool, { nombre: 'Ana' });
      const mascotaId = await crearMascota(pool, usuaria.id, { nombre: 'Canela' });
      const sesion = await crearSesion(pool, usuaria.id);

      const frontera = '----huella';
      const subida = await sinLector.inject({
        method: 'POST',
        url: `/mascotas/${mascotaId}/documentos`,
        headers: { authorization: `Bearer ${sesion}`, 'content-type': `multipart/form-data; boundary=${frontera}` },
        payload: Buffer.concat([
          Buffer.from(
            `--${frontera}\r\nContent-Disposition: form-data; name="archivo"; filename="c.jpg"\r\n` +
              'Content-Type: image/jpeg\r\n\r\n',
          ),
          Buffer.from('foto'),
          Buffer.from(`\r\n--${frontera}--\r\n`),
        ]),
      });
      expect(subida.statusCode).toBe(201);

      const r = await sinLector.inject({
        method: 'POST',
        url: `/documentos/${JSON.parse(subida.body).id}/lectura`,
        headers: { authorization: `Bearer ${sesion}` },
      });

      expect(r.statusCode).toBe(422);
      expect(JSON.parse(r.body).mensaje).toMatch(/a mano/i);
    } finally {
      await sinLector.close();
    }
  });
});

describe('confirmar lo que la clienta aprobó', () => {
  it('guarda la mascota y las vacunas que ella dejó pasar', async () => {
    const { mascota, sesion } = await comoClienta();
    const documentoId = await subirCarnet(sesion, mascota.id);
    const { propuesta } = JSON.parse(
      (await pedir(sesion, `/documentos/${documentoId}/lectura`, { method: 'POST' })).body,
    );

    const r = await pedir(sesion, `/mascotas/${mascota.id}/carnet/confirmacion`, {
      method: 'POST',
      payload: { documentoId, mascota: propuesta.mascota, aplicaciones: propuesta.aplicaciones },
    });

    expect(r.statusCode, r.body).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ mascotaActualizada: true, aplicacionesGuardadas: 2 });

    const { rows } = await pool.query(
      `SELECT raza, sexo, nacimiento_precision, peso_kg FROM mascota WHERE id = $1`,
      [mascota.id],
    );
    expect(rows[0]).toMatchObject({ raza: 'Schnauzer', sexo: 'hembra', nacimiento_precision: 'anio' });

    const { rows: vacunas } = await pool.query(
      `SELECT producto, fecha_aplicacion, fecha_refuerzo, documento_id
         FROM aplicacion WHERE mascota_id = $1 ORDER BY fecha_aplicacion DESC`,
      [mascota.id],
    );
    expect(vacunas[0]).toMatchObject({ producto: 'Rabia', documento_id: documentoId });
  });

  it('guarda lo que ella corrigió, no lo que se leyó', async () => {
    // Es el punto de tener la pantalla: el lector dijo hembra y Schnauzer, y
    // ella sabe que es macho y mestizo.
    const { mascota, sesion } = await comoClienta();

    await pedir(sesion, `/mascotas/${mascota.id}/carnet/confirmacion`, {
      method: 'POST',
      payload: { mascota: { sexo: 'macho', raza: 'Mestizo' }, aplicaciones: [] },
    });

    const { rows } = await pool.query(`SELECT sexo, raza FROM mascota WHERE id = $1`, [mascota.id]);
    expect(rows[0]).toMatchObject({ sexo: 'macho', raza: 'Mestizo' });
  });

  it('subir el carnet dos veces no duplica las vacunas', async () => {
    // Volver a tomar la foto porque salió movida es lo normal. Duplicar la
    // vacuna significaría dos avisos de refuerzo para la misma dosis.
    const { mascota, sesion } = await comoClienta();
    const vacunas = [
      { producto: 'Rabia', fechaAplicacion: '2026-03-10', fechaRefuerzo: '2027-03-10' },
      { producto: 'Quíntuple', fechaAplicacion: '2025-11-02' },
    ];

    await pedir(sesion, `/mascotas/${mascota.id}/carnet/confirmacion`,
      { method: 'POST', payload: { aplicaciones: vacunas } });
    const segunda = await pedir(sesion, `/mascotas/${mascota.id}/carnet/confirmacion`,
      { method: 'POST', payload: { aplicaciones: vacunas } });

    expect(JSON.parse(segunda.body)).toMatchObject({ aplicacionesGuardadas: 0, aplicacionesRepetidas: 2 });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM aplicacion WHERE mascota_id = $1`, [mascota.id],
    );
    expect(rows[0].n).toBe(2);
  });

  it('si una vacuna viene mal, no se guarda nada a medias', async () => {
    const { mascota, sesion } = await comoClienta();

    const r = await pedir(sesion, `/mascotas/${mascota.id}/carnet/confirmacion`, {
      method: 'POST',
      payload: {
        mascota: { raza: 'Schnauzer' },
        aplicaciones: [
          { producto: 'Rabia', fechaAplicacion: '2026-03-10' },
          { producto: 'Quíntuple', fechaAplicacion: 'el martes' },
        ],
      },
    });

    expect(r.statusCode).toBe(400);
    const { rows } = await pool.query(
      `SELECT raza, (SELECT count(*)::int FROM aplicacion WHERE mascota_id = $1) AS vacunas
         FROM mascota WHERE id = $1`,
      [mascota.id],
    );
    expect(rows[0]).toMatchObject({ raza: null, vacunas: 0 });
  });

  it('no se puede confirmar sobre la mascota de otra clienta', async () => {
    const mia = await comoClienta();
    const ajena = await comoClienta();

    const r = await pedir(mia.sesion, `/mascotas/${ajena.mascota.id}/carnet/confirmacion`, {
      method: 'POST',
      payload: { mascota: { raza: 'Metida' } },
    });

    expect(r.statusCode).toBe(404);
  });
});
