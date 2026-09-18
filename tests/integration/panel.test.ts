/**
 * El panel interno, probado por HTTP contra la base real.
 *
 * Estas pruebas levantan el servidor de verdad y le pegan a las rutas, en vez
 * de llamar a las funciones por dentro. Es a propósito: el hueco que motivó
 * este archivo fue una ruta que NO quedó registrada, y una prueba que llama a
 * la función directamente habría pasado igual mientras el panel devolvía 404.
 */
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CDMX,
  crearMascota,
  crearProveedor,
  crearUsuaria,
  limpiar,
  prepararBase,
} from '../ayuda/db.js';
import { crearServidor } from '../../src/http/servidor.js';
import { cargarConfig } from '../../src/config/index.js';
import { crearCanalWhatsApp } from '../../src/channels/whatsapp/index.js';
import { AlmacenEnMemoria, llaveDesdeBase64 } from '../../src/modules/almacenamiento/index.js';
import { PasarelaFalsa } from '../../src/modules/suscripcion/servicio.js';
import { numerosDelPiloto } from '../../src/modules/panel/numeros.js';
import { programarRecordatoriosDeCita } from '../../src/modules/recordatorios/servicio.js';
import { instanteDesdeLocal } from '../../src/domain/tiempo.js';
import { randomBytes } from 'node:crypto';

let pool: pg.Pool;
let app: FastifyInstance;
let credencial: string;

/** Todas las rutas que el panel necesita para funcionar. */
const RUTAS_DEL_PANEL = [
  '/panel/api/avisos-hoy',
  '/panel/api/clientas',
  '/panel/api/citas',
  '/panel/api/numeros',
  '/panel/api/bandeja',
  '/panel/api/suscripciones',
  '/panel/api/salud-envios',
  '/panel/api/proveedores-compartidos',
] as const;

beforeAll(async () => {
  pool = await prepararBase();
  const config = cargarConfig();
  app = await crearServidor({
    pool,
    config,
    whatsapp: crearCanalWhatsApp({ driver: 'fake' }),
    almacen: new AlmacenEnMemoria(llaveDesdeBase64(randomBytes(32).toString('base64'))),
    pasarela: new PasarelaFalsa(),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await limpiar(pool);
  const clave = 'secreta';
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO usuario_interno (correo, nombre, rol, contrasena_hash)
     VALUES ('operadora@huella.mx', 'Operadora', 'administradora', $1)
     RETURNING id`,
    [createHash('sha256').update(clave).digest('hex')],
  );
  expect(rows[0]).toBeDefined();
  credencial = Buffer.from(`operadora@huella.mx:${clave}`).toString('base64');
});

function pedir(url: string, opciones: { method?: string; payload?: unknown; sinCredencial?: boolean } = {}) {
  return app.inject({
    method: (opciones.method ?? 'GET') as 'GET',
    url,
    headers: opciones.sinCredencial ? {} : { authorization: `Bearer ${credencial}` },
    ...(opciones.payload ? { payload: opciones.payload as object } : {}),
  });
}

describe('todas las rutas del panel responden', () => {
  // Ésta es la prueba que habría cachado el hueco: una ruta que no quedó
  // registrada devuelve 404 aunque su función exista y compile.
  it.each(RUTAS_DEL_PANEL)('%s responde 200 con credencial', async (ruta) => {
    const r = await pedir(ruta);
    expect(r.statusCode, `${ruta} devolvió ${r.statusCode}: ${r.body.slice(0, 200)}`).toBe(200);
    expect(() => JSON.parse(r.body)).not.toThrow();
  });

  it.each(RUTAS_DEL_PANEL)('%s rechaza a quien no trae credencial', async (ruta) => {
    expect((await pedir(ruta, { sinCredencial: true })).statusCode).toBe(401);
  });

  it('la interfaz se sirve en /panel y no la tapa la API', async () => {
    const pagina = await pedir('/panel', { sinCredencial: true });
    expect(pagina.statusCode).toBe(200);
    expect(pagina.headers['content-type']).toContain('text/html');
    expect(pagina.body).toContain('Panel de Huella');

    for (const archivo of ['/panel/marca.css', '/panel/panel.css', '/panel/panel.js']) {
      expect((await pedir(archivo, { sinCredencial: true })).statusCode, archivo).toBe(200);
    }
  });
});

describe('/numeros', () => {
  it('devuelve las siete cifras del piloto', async () => {
    const r = await pedir('/panel/api/numeros');
    expect(r.statusCode).toBe(200);
    const cuerpo = JSON.parse(r.body);

    for (const clave of [
      'personasInvitadas',
      'clientasActivas',
      'pagando',
      'tasaAceptacion',
      'citasAgendadas',
      'citasCumplidas',
      'pendientesDeHoy',
    ]) {
      expect(cuerpo, `falta ${clave}`).toHaveProperty(clave);
    }
    expect(cuerpo.envios).toHaveProperty('muestra');
  });

  it('sin nadie invitada, la tasa es «no hay tasa» y no cero por ciento', async () => {
    const n = await numerosDelPiloto(pool);
    expect(n.personasInvitadas).toBe(0);
    // Un 0 % el primer día haría ver el piloto como un fracaso cuando todavía
    // no ha empezado.
    expect(n.tasaAceptacion).toBeNull();
  });

  it('cuenta invitadas, activas y pagando por separado', async () => {
    const enPrueba = await crearUsuaria(pool);
    await pool.query(`UPDATE usuaria SET estado = 'prueba' WHERE id = $1`, [enPrueba.id]);

    const pagando = await crearUsuaria(pool);
    await pool.query(`UPDATE usuaria SET estado = 'activa' WHERE id = $1`, [pagando.id]);

    const dada_de_baja = await crearUsuaria(pool);
    await pool.query(`UPDATE usuaria SET estado = 'cancelada' WHERE id = $1`, [dada_de_baja.id]);

    const n = await numerosDelPiloto(pool);
    expect(n.personasInvitadas).toBe(3);
    // La de baja cuenta como invitada pero no como activa.
    expect(n.clientasActivas).toBe(2);
    expect(n.pagando).toBe(1);
    expect(n.tasaAceptacion).toBe(67);
  });

  it('no cuenta a quien pidió el borrado de sus datos', async () => {
    const usuaria = await crearUsuaria(pool);
    await pool.query(`UPDATE usuaria SET anonimizada_en = now() WHERE id = $1`, [usuaria.id]);
    expect((await numerosDelPiloto(pool)).personasInvitadas).toBe(0);
  });

  it('cuenta citas agendadas y cumplidas, y descarta las canceladas', async () => {
    const usuaria = await crearUsuaria(pool);
    const mascotaId = await crearMascota(pool, usuaria.id);
    const proveedorId = await crearProveedor(pool);
    const cuando = instanteDesdeLocal('2026-10-22', '11:00', CDMX);

    for (const estado of ['confirmada', 'cumplida', 'cancelada'] as const) {
      await pool.query(
        `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en)
         VALUES ($1,$2,$3,'bano',$4::estado_cita,$5)`,
        [usuaria.id, mascotaId, proveedorId, estado, cuando],
      );
    }

    const n = await numerosDelPiloto(pool);
    expect(n.citasAgendadas).toBe(2);
    expect(n.citasCumplidas).toBe(1);
  });

  it('los pendientes de hoy incluyen los que quedaron atrás sin salir', async () => {
    const usuaria = await crearUsuaria(pool, { horaAvisoDia: '08:00' });
    const mascotaId = await crearMascota(pool, usuaria.id);
    const proveedorId = await crearProveedor(pool);
    const cuando = instanteDesdeLocal('2026-10-22', '11:00', CDMX);

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en, costo_confirmado)
       VALUES ($1,$2,$3,'bano','confirmada',$4,450) RETURNING id`,
      [usuaria.id, mascotaId, proveedorId, cuando],
    );
    await programarRecordatoriosDeCita(pool, rows[0]!.id, {
      ahora: instanteDesdeLocal('2026-10-01', '09:00', CDMX),
      momentos: ['t_7', 't_3', 't_0'],
    });

    // Vistos desde el día de la cita: el T−7 y el T−3 ya vencieron y el T−0 es hoy.
    const n = await numerosDelPiloto(pool, { fecha: '2026-10-22' });
    expect(n.pendientesDeHoy).toBe(3);

    // Vistos desde antes, no hay nada pendiente todavía.
    expect((await numerosDelPiloto(pool, { fecha: '2026-10-01' })).pendientesDeHoy).toBe(0);
  });
});

describe('alta de clienta desde el panel', () => {
  const alta = {
    clienta: { nombre: 'María Fernanda Ruiz', celular: '55 4433 2211' },
    mascota: { nombre: 'Canela', especie: 'perro', raza: 'Schnauzer', pesoKg: 8 },
    proveedor: { negocio: 'Petco', sucursal: 'Polanco', telefono: '55 1122 3344' },
    rutina: {
      tipoServicio: 'bano',
      frecuenciaCantidad: 1,
      frecuenciaUnidad: 'meses',
      costoReferencia: 450,
      proximaFechaEstimada: '2026-11-20',
    },
  };

  it('crea clienta, mascota y rutina de una vez, y queda contada', async () => {
    const r = await pedir('/panel/api/clientas', { method: 'POST', payload: alta });
    expect(r.statusCode).toBe(201);

    const creada = JSON.parse(r.body);
    expect(creada.usuariaId).toBeTruthy();
    expect(creada.mascotaId).toBeTruthy();
    expect(creada.rutinaId).toBeTruthy();
    expect(creada.proximaFechaEstimada).toBe('2026-11-20');

    const n = await numerosDelPiloto(pool);
    expect(n.personasInvitadas).toBe(1);
    expect(n.clientasActivas).toBe(1);

    // Y aparece en la lista que pinta la pestaña de Clientas.
    const lista = JSON.parse((await pedir('/panel/api/clientas')).body);
    expect(lista.clientas).toHaveLength(1);
    expect(lista.clientas[0].mascotas).toEqual(['Canela']);
    expect(lista.clientas[0].celularVerificado).toBe(false);
  });

  it('registra el consentimiento del aviso de privacidad (sección 09)', async () => {
    const r = await pedir('/panel/api/clientas', { method: 'POST', payload: alta });
    const { usuariaId } = JSON.parse(r.body);

    const { rows } = await pool.query<{ tipo: string; version: string; evidencia: { medio: string } }>(
      `SELECT tipo, version, evidencia FROM consentimiento WHERE usuaria_id = $1`,
      [usuariaId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tipo).toBe('aviso_privacidad');
    // Quién lo capturó importa: el alta fue manual, no la aceptó ella en pantalla.
    expect(rows[0]!.evidencia.medio).toBe('panel_interno');
  });

  it('reusa el negocio que otra clienta ya registró (sección 11)', async () => {
    const primera = JSON.parse((await pedir('/panel/api/clientas', { method: 'POST', payload: alta })).body);

    const segunda = JSON.parse(
      (
        await pedir('/panel/api/clientas', {
          method: 'POST',
          payload: {
            ...alta,
            clienta: { nombre: 'Otra clienta', celular: '55 9999 0000' },
            // El mismo negocio escrito distinto, con el mismo teléfono.
            proveedor: { negocio: 'PETCO Masaryk', telefono: '+52 55 1122 3344' },
          },
        })
      ).body,
    );

    expect(segunda.proveedorYaExistia).toBe(true);
    expect(segunda.proveedorId).toBe(primera.proveedorId);
  });

  it('rechaza un celular repetido con 409 y un mensaje claro', async () => {
    await pedir('/panel/api/clientas', { method: 'POST', payload: alta });
    const r = await pedir('/panel/api/clientas', { method: 'POST', payload: alta });

    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body).error).toBe('celular_ya_registrado');
  });

  it('explica qué campo falta cuando los datos vienen mal', async () => {
    const r = await pedir('/panel/api/clientas', {
      method: 'POST',
      payload: { ...alta, clienta: { nombre: '', celular: '5511110000' } },
    });

    expect(r.statusCode).toBe(400);
    const cuerpo = JSON.parse(r.body);
    expect(cuerpo.error).toBe('datos_invalidos');
    expect(cuerpo.detalles[0].campo).toBe('clienta.nombre');
    expect(cuerpo.detalles[0].mensaje).toBe('Falta el nombre de la clienta.');
  });

  it('una operadora no puede borrar los datos de una clienta', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO usuario_interno (correo, nombre, rol, contrasena_hash)
       VALUES ('solo.operadora@huella.mx', 'Operadora', 'operadora', $1) RETURNING id`,
      [createHash('sha256').update('secreta').digest('hex')],
    );
    expect(rows[0]).toBeDefined();

    const creada = JSON.parse((await pedir('/panel/api/clientas', { method: 'POST', payload: alta })).body);
    credencial = Buffer.from('solo.operadora@huella.mx:secreta').toString('base64');

    const r = await pedir(`/panel/api/usuarias/${creada.usuariaId}`, { method: 'DELETE' });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error).toBe('sin_permiso');
  });
});

describe('pestaña Hoy', () => {
  it('trae el texto ya redactado y el enlace de WhatsApp, y se marca enviado', async () => {
    const usuaria = await crearUsuaria(pool, { nombre: 'Ana', horaAvisoDia: '08:00' });
    const mascotaId = await crearMascota(pool, usuaria.id, { nombre: 'Lola' });
    const proveedorId = await crearProveedor(pool);
    const cuando = instanteDesdeLocal('2026-10-22', '11:00', CDMX);

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en, costo_confirmado)
       VALUES ($1,$2,$3,'bano','confirmada',$4,450) RETURNING id`,
      [usuaria.id, mascotaId, proveedorId, cuando],
    );
    await programarRecordatoriosDeCita(pool, rows[0]!.id, {
      ahora: instanteDesdeLocal('2026-10-01', '09:00', CDMX),
      momentos: ['t_7'],
    });

    const r = await pedir('/panel/api/avisos-hoy?fecha=2026-10-15');
    expect(r.statusCode).toBe(200);
    const cuerpo = JSON.parse(r.body);

    expect(cuerpo.avisos).toHaveLength(1);
    const aviso = cuerpo.avisos[0];

    // El texto es el del sistema, no uno que el panel vuelva a escribir: si se
    // separaran, la operadora leería una cosa y la clienta recibiría otra.
    expect(aviso.texto).toContain('baño de Lola');
    expect(aviso.texto).toContain('Petco Polanco');
    expect(aviso.texto).toContain('$450');
    expect(aviso.texto).toContain('22 de octubre');
    expect(aviso.enlaceWhatsApp).toContain('wa.me/');
    expect(aviso.enlaceWhatsApp).toContain(usuaria.celular.replace('+', ''));

    const enviado = await pedir(`/panel/api/avisos/${aviso.id}/enviado`, {
      method: 'POST',
      payload: { texto: aviso.texto },
    });
    expect(enviado.statusCode).toBe(200);

    // Se guarda el retraso real, igual que si lo hubiera mandado el barrido.
    const { rows: guardado } = await pool.query<{ estado: string; canal: string; retraso_segundos: number }>(
      `SELECT estado, canal, retraso_segundos FROM recordatorio WHERE id = $1`,
      [aviso.id],
    );
    expect(guardado[0]!.estado).toBe('enviado');
    expect(guardado[0]!.canal).toBe('whatsapp_manual');
    expect(guardado[0]!.retraso_segundos).toBeGreaterThanOrEqual(0);

    // Marcarlo dos veces no debe contar como dos envíos.
    expect((await pedir(`/panel/api/avisos/${aviso.id}/enviado`, {
      method: 'POST',
      payload: { texto: aviso.texto },
    })).statusCode).toBe(409);
  });
});
