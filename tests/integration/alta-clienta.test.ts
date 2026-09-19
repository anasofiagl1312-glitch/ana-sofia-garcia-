/**
 * El alta que llena la clienta desde su teléfono, y el correo como segundo
 * canal de aviso.
 *
 * Todo por HTTP: el enlace se canjea, la sesión se usa contra las mismas rutas
 * que usaría la app de la Fase 3, y el panel ve el resultado.
 */
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { CDMX, crearMascota, crearProveedor, crearUsuaria, limpiar, prepararBase } from '../ayuda/db.js';
import { crearServidor } from '../../src/http/servidor.js';
import { cargarConfig } from '../../src/config/index.js';
import { crearCanalWhatsApp } from '../../src/channels/whatsapp/index.js';
import { AlmacenEnMemoria, llaveDesdeBase64 } from '../../src/modules/almacenamiento/index.js';
import { PasarelaFalsa } from '../../src/modules/suscripcion/servicio.js';
import { SinLector } from '../../src/channels/carnet/index.js';
import { crearInvitacion, estadoDeInvitacion } from '../../src/modules/alta/invitaciones.js';
import { avisosDelDia } from '../../src/modules/panel/avisos.js';
import { asuntoDeAviso, enlaceCorreo } from '../../src/modules/mensajes/correo.js';
import { programarRecordatoriosDeCita } from '../../src/modules/recordatorios/servicio.js';
import { instanteDesdeLocal } from '../../src/domain/tiempo.js';
import type { DatosAviso } from '../../src/modules/mensajes/contenido.js';

let pool: pg.Pool;
let app: FastifyInstance;
let credencial: string;

beforeAll(async () => {
  pool = await prepararBase();
  app = await crearServidor({
    pool,
    config: cargarConfig(),
    whatsapp: crearCanalWhatsApp({ driver: 'fake' }),
    almacen: new AlmacenEnMemoria(llaveDesdeBase64(randomBytes(32).toString('base64'))),
    pasarela: new PasarelaFalsa(),
    lectorDeCarnet: new SinLector(),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await limpiar(pool);
  await pool.query(
    `INSERT INTO usuario_interno (correo, nombre, rol, contrasena_hash)
     VALUES ('operadora@huella.mx', 'Operadora', 'administradora', $1)`,
    [createHash('sha256').update('secreta').digest('hex')],
  );
  credencial = Buffer.from('operadora@huella.mx:secreta').toString('base64');
});

function panel(url: string, opciones: { method?: string; payload?: unknown } = {}) {
  return app.inject({
    method: (opciones.method ?? 'GET') as 'GET',
    url,
    headers: { authorization: `Bearer ${credencial}` },
    ...(opciones.payload ? { payload: opciones.payload as object } : {}),
  });
}

function comoClienta(sesion: string, url: string, opciones: { method?: string; payload?: unknown } = {}) {
  return app.inject({
    method: (opciones.method ?? 'GET') as 'GET',
    url,
    headers: { authorization: `Bearer ${sesion}` },
    ...(opciones.payload ? { payload: opciones.payload as object } : {}),
  });
}

describe('enlace de alta', () => {
  it('el panel lo genera y la clienta lo canjea por una sesión', async () => {
    const usuaria = await crearUsuaria(pool, { nombre: 'María Fernanda Ruiz' });

    const r = await panel(`/panel/api/clientas/${usuaria.id}/invitacion`, { method: 'POST' });
    expect(r.statusCode).toBe(200);

    const { enlace, expiraEn } = JSON.parse(r.body);
    expect(enlace).toContain('/alta#');
    expect(new Date(expiraEn).getTime()).toBeGreaterThan(Date.now());

    const token = enlace.split('#')[1];
    const canje = await app.inject({ method: 'POST', url: '/alta/api/sesion', payload: { token } });
    expect(canje.statusCode).toBe(200);

    const datos = JSON.parse(canje.body);
    expect(datos.sesion).toBeTruthy();
    expect(datos.clienta.nombre).toBe('María Fernanda Ruiz');
    expect(datos.mascotas).toEqual([]);

    // Y la sesión sirve contra las rutas normales de la clienta.
    const yo = await comoClienta(datos.sesion, '/yo');
    expect(yo.statusCode).toBe(200);
    expect(JSON.parse(yo.body).usuaria.nombre).toBe('María Fernanda Ruiz');
  });

  it('un token que no existe da el mismo error que uno vencido', async () => {
    const usuaria = await crearUsuaria(pool);
    const { token } = await crearInvitacion(pool, usuaria.id, {
      // Ya vencido.
      ahora: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    const vencido = await app.inject({ method: 'POST', url: '/alta/api/sesion', payload: { token } });
    const inventado = await app.inject({
      method: 'POST',
      url: '/alta/api/sesion',
      payload: { token: randomBytes(32).toString('base64url') },
    });

    expect(vencido.statusCode).toBe(410);
    expect(inventado.statusCode).toBe(410);
    // Distinguirlos le diría a quien pruebe tokens al azar cuándo acertó a medias.
    expect(JSON.parse(vencido.body).mensaje).toBe(JSON.parse(inventado.body).mensaje);
  });

  it('generar un enlace nuevo revoca el anterior', async () => {
    const usuaria = await crearUsuaria(pool);
    const primero = JSON.parse((await panel(`/panel/api/clientas/${usuaria.id}/invitacion`, { method: 'POST' })).body);
    const segundo = JSON.parse((await panel(`/panel/api/clientas/${usuaria.id}/invitacion`, { method: 'POST' })).body);

    const viejo = await app.inject({
      method: 'POST', url: '/alta/api/sesion', payload: { token: primero.enlace.split('#')[1] },
    });
    const nuevo = await app.inject({
      method: 'POST', url: '/alta/api/sesion', payload: { token: segundo.enlace.split('#')[1] },
    });

    expect(viejo.statusCode).toBe(410);
    expect(nuevo.statusCode).toBe(200);
  });

  it('el panel ve si lo abrió y si lo terminó', async () => {
    const usuaria = await crearUsuaria(pool);
    const { enlace } = JSON.parse((await panel(`/panel/api/clientas/${usuaria.id}/invitacion`, { method: 'POST' })).body);

    expect(await estadoDeInvitacion(pool, usuaria.id)).toMatchObject({ tiene: true, abiertaEn: null, completadaEn: null });

    const { sesion } = JSON.parse(
      (await app.inject({ method: 'POST', url: '/alta/api/sesion', payload: { token: enlace.split('#')[1] } })).body,
    );
    expect((await estadoDeInvitacion(pool, usuaria.id)).abiertaEn).not.toBeNull();

    await comoClienta(sesion, '/alta/api/listo', { method: 'POST' });
    expect((await estadoDeInvitacion(pool, usuaria.id)).completadaEn).not.toBeNull();

    // Y sale en el listado del panel, que es donde la operadora lo mira.
    const lista = JSON.parse((await panel('/panel/api/clientas')).body);
    expect(lista.clientas[0].invitacion.completadaEn).not.toBeNull();
  });

  it('no sirve para una clienta que pidió el borrado de sus datos', async () => {
    const usuaria = await crearUsuaria(pool);
    const { token } = await crearInvitacion(pool, usuaria.id);
    await pool.query(`UPDATE usuaria SET anonimizada_en = now() WHERE id = $1`, [usuaria.id]);

    expect((await app.inject({ method: 'POST', url: '/alta/api/sesion', payload: { token } })).statusCode).toBe(410);
  });
});

describe('la clienta llena sus datos', () => {
  async function entrar() {
    const usuaria = await crearUsuaria(pool, { nombre: 'Ana Sofía León' });
    const { token } = await crearInvitacion(pool, usuaria.id);
    const { sesion } = JSON.parse(
      (await app.inject({ method: 'POST', url: '/alta/api/sesion', payload: { token } })).body,
    );
    return { usuaria, sesion: sesion as string };
  }

  it('registra su mascota con todo lo que el negocio necesita saber', async () => {
    const { usuaria, sesion } = await entrar();

    const r = await comoClienta(sesion, '/mascotas', {
      method: 'POST',
      payload: {
        nombre: 'Lola',
        especie: 'perro',
        raza: 'Schnauzer',
        pesoKg: 8.5,
        sexo: 'hembra',
        notasManejo: 'Se pone nerviosa con la secadora',
      },
    });
    expect(r.statusCode).toBe(201);

    const { rows } = await pool.query<{ nombre: string; notas_manejo: string; peso_kg: number }>(
      `SELECT nombre, notas_manejo, peso_kg FROM mascota WHERE usuaria_id = $1`,
      [usuaria.id],
    );
    expect(rows[0]).toMatchObject({ nombre: 'Lola', notas_manejo: 'Se pone nerviosa con la secadora', peso_kg: 8.5 });
  });

  it('puede corregir especie, sexo y fecha de nacimiento', async () => {
    const { usuaria, sesion } = await entrar();
    const mascotaId = await crearMascota(pool, usuaria.id, { nombre: 'Fito' });

    const r = await comoClienta(sesion, `/mascotas/${mascotaId}`, {
      method: 'PATCH',
      payload: { especie: 'gato', sexo: 'macho', nacimiento: '2022-03-15' },
    });
    expect(r.statusCode).toBe(200);

    const { rows } = await pool.query(`SELECT especie, sexo, nacimiento FROM mascota WHERE id = $1`, [mascotaId]);
    expect(rows[0]).toMatchObject({ especie: 'gato', sexo: 'macho', nacimiento: '2022-03-15' });
  });

  it('sube el carnet y captura una vacuna', async () => {
    const { usuaria, sesion } = await entrar();
    const mascotaId = await crearMascota(pool, usuaria.id);

    const aplicacion = await comoClienta(sesion, `/mascotas/${mascotaId}/aplicaciones`, {
      method: 'POST',
      payload: {
        producto: 'Rabia',
        marca: 'Nobivac',
        fechaAplicacion: '2026-01-10',
        fechaRefuerzo: '2027-01-10',
        veterinario: 'Dra. Martínez',
      },
    });
    expect(aplicacion.statusCode).toBe(201);

    const carnet = JSON.parse((await comoClienta(sesion, `/mascotas/${mascotaId}/carnet`)).body);
    expect(carnet.aplicaciones).toHaveLength(1);
    expect(carnet.aplicaciones[0].producto).toBe('Rabia');
    expect(usuaria.id).toBeTruthy();
  });

  it('registra su veterinaria, y queda marcada como tal', async () => {
    const { usuaria, sesion } = await entrar();

    const r = await comoClienta(sesion, '/proveedores', {
      method: 'POST',
      payload: {
        negocio: 'Veterinaria San Ángel',
        direccion: 'Av. Revolución 1877',
        telefono: '55 2233 4455',
        relacion: 'veterinaria',
      },
    });
    expect(r.statusCode).toBe(201);

    const { rows } = await pool.query<{ relacion: string }>(
      `SELECT relacion FROM usuaria_proveedor WHERE usuaria_id = $1`,
      [usuaria.id],
    );
    expect(rows[0]!.relacion).toBe('veterinaria');

    const lista = JSON.parse((await comoClienta(sesion, '/proveedores')).body);
    expect(lista.proveedores[0].relacion).toBe('veterinaria');
  });

  it('guarda sus preferencias de contacto y de horario', async () => {
    const { usuaria, sesion } = await entrar();

    expect(
      (await comoClienta(sesion, '/yo', {
        method: 'PATCH',
        payload: { correo: 'ana@ejemplo.com', canalPreferido: 'ambos', horaAvisoDia: '07:30' },
      })).statusCode,
    ).toBe(200);

    expect(
      (await comoClienta(sesion, '/yo/preferencias', {
        method: 'PUT',
        payload: {
          preferencias: [
            { diaSemana: 4, horaInicio: '10:00', horaFin: '13:00', prioridad: 1 },
            { diaSemana: 6, horaInicio: '09:00', horaFin: '12:00', prioridad: 2 },
          ],
        },
      })).statusCode,
    ).toBe(200);

    const { rows } = await pool.query<{ correo: string; canal_preferido: string; hora_aviso_dia: string }>(
      `SELECT correo, canal_preferido, hora_aviso_dia FROM usuaria WHERE id = $1`,
      [usuaria.id],
    );
    expect(rows[0]).toMatchObject({ correo: 'ana@ejemplo.com', canal_preferido: 'ambos' });

    const { rows: preferencias } = await pool.query(
      `SELECT count(*)::int AS cuantas FROM preferencia_agenda WHERE usuaria_id = $1`,
      [usuaria.id],
    );
    expect((preferencias[0] as { cuantas: number }).cuantas).toBe(2);
  });

  it('no deja elegir correo sin haber dado un correo, y lo dice claro', async () => {
    const { sesion } = await entrar();

    const r = await comoClienta(sesion, '/yo', { method: 'PATCH', payload: { canalPreferido: 'correo' } });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).mensaje).toContain('correo electrónico');
  });

  it('un correo que ya es de otra clienta se explica, no revienta', async () => {
    const primera = await entrar();
    expect(
      (await comoClienta(primera.sesion, '/yo', { method: 'PATCH', payload: { correo: 'compartido@ejemplo.com' } }))
        .statusCode,
    ).toBe(200);

    // Dos personas de la misma casa poniendo el mismo correo es el caso normal,
    // no el raro. Sin esto el índice único sale como un 500 sin explicación,
    // justo en el último paso del alta.
    const segunda = await entrar();
    const r = await comoClienta(segunda.sesion, '/yo', {
      method: 'PATCH',
      payload: { correo: 'compartido@ejemplo.com', canalPreferido: 'ambos' },
    });

    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body).mensaje).toContain('ya está registrado');
  });

  it('rechaza un correo mal escrito antes de guardarlo', async () => {
    const { sesion } = await entrar();
    const r = await comoClienta(sesion, '/yo', { method: 'PATCH', payload: { correo: 'ana-arroba-ejemplo' } });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).detalles[0].mensaje).toBe('Ese correo no se ve bien.');
  });

  it('no puede ver ni tocar los datos de otra clienta', async () => {
    const { sesion } = await entrar();
    const otra = await crearUsuaria(pool);
    const suMascota = await crearMascota(pool, otra.id);

    expect((await comoClienta(sesion, `/mascotas/${suMascota}/carnet`)).statusCode).toBe(404);
    expect(
      (await comoClienta(sesion, `/mascotas/${suMascota}`, { method: 'PATCH', payload: { nombre: 'Otro' } }))
        .statusCode,
    ).toBe(404);
  });

  it('la interfaz de la clienta se sirve en /alta', async () => {
    const pagina = await app.inject({ method: 'GET', url: '/alta' });
    expect(pagina.statusCode).toBe(200);
    expect(pagina.headers['content-type']).toContain('text/html');

    for (const archivo of ['/alta/alta.css', '/alta/alta.js', '/marca.css']) {
      expect((await app.inject({ method: 'GET', url: archivo })).statusCode, archivo).toBe(200);
    }
  });
});

describe('el correo como segundo canal', () => {
  const DATOS: DatosAviso = {
    servicio: 'Baño',
    articuloServicio: 'el',
    mascota: 'Lola',
    nombrePila: 'Ana',
    iniciaEn: instanteDesdeLocal('2026-10-22', '11:00', CDMX),
    zona: CDMX,
    proveedor: 'Petco Polanco',
    direccion: 'Av. Masaryk 275',
    costo: 450,
  };

  it('el asunto dice qué pasa y de quién, sin abrirlo', () => {
    expect(asuntoDeAviso('t_7', DATOS)).toBe('Falta una semana para el baño de Lola');
    expect(asuntoDeAviso('t_3', DATOS)).toBe('Faltan 3 días para el baño de Lola');
    expect(asuntoDeAviso('t_0', DATOS)).toBe('Hoy es el baño de Lola, a las 11:00');
    expect(asuntoDeAviso('t_21', DATOS)).toBe('¿Qué día te acomoda para el baño de Lola?');
    expect(asuntoDeAviso('cierre', DATOS)).toBe('¿Cómo les fue ayer con Lola?');
    expect(asuntoDeAviso('confirmacion', DATOS)).toContain('quedó el jueves 22 de octubre');
  });

  it('el enlace mailto codifica el salto de línea y el espacio como debe', () => {
    const enlace = enlaceCorreo('ana@ejemplo.com', { asunto: 'Hola Ana', cuerpo: 'Línea uno\nLínea dos' });
    expect(enlace.startsWith('mailto:ana%40ejemplo.com?')).toBe(true);
    expect(enlace).toContain('subject=Hola%20Ana');
    expect(enlace).toContain('%0A');
    // Un "+" en el cuerpo de un mailto se ve literalmente como un "+".
    expect(enlace).not.toContain('+');
  });

  it('el panel ofrece correo solo a quien lo dio, y el cuerpo es el mismo de WhatsApp', async () => {
    const usuaria = await crearUsuaria(pool, { nombre: 'Ana', horaAvisoDia: '08:00' });
    await pool.query(`UPDATE usuaria SET correo = 'ana@ejemplo.com', canal_preferido = 'ambos' WHERE id = $1`, [
      usuaria.id,
    ]);
    const mascotaId = await crearMascota(pool, usuaria.id, { nombre: 'Lola' });
    const proveedorId = await crearProveedor(pool);
    const iniciaEn = instanteDesdeLocal('2026-10-22', '11:00', CDMX);

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en, costo_confirmado)
       VALUES ($1,$2,$3,'bano','confirmada',$4,450) RETURNING id`,
      [usuaria.id, mascotaId, proveedorId, iniciaEn],
    );
    await programarRecordatoriosDeCita(pool, rows[0]!.id, {
      ahora: instanteDesdeLocal('2026-10-01', '09:00', CDMX),
      momentos: ['t_7'],
    });

    const avisos = await avisosDelDia(pool, '2026-10-15');
    expect(avisos).toHaveLength(1);
    const aviso = avisos[0]!;

    expect(aviso.canalPreferido).toBe('ambos');
    expect(aviso.correo).toBe('ana@ejemplo.com');
    expect(aviso.asunto).toBe('Falta una semana para el baño de Lola');
    expect(aviso.enlaceCorreo).toContain('mailto:');
    // El cuerpo NO se reescribe para el correo: es el mismo copy validado.
    expect(decodeURIComponent(aviso.enlaceCorreo!)).toContain(aviso.texto);
    expect(aviso.enlaceWhatsApp).toContain('wa.me/');
  });

  it('sin correo no ofrece el enlace de correo', async () => {
    const usuaria = await crearUsuaria(pool, { horaAvisoDia: '08:00' });
    const mascotaId = await crearMascota(pool, usuaria.id);
    const proveedorId = await crearProveedor(pool);
    const iniciaEn = instanteDesdeLocal('2026-10-22', '11:00', CDMX);

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en, costo_confirmado)
       VALUES ($1,$2,$3,'bano','confirmada',$4,450) RETURNING id`,
      [usuaria.id, mascotaId, proveedorId, iniciaEn],
    );
    await programarRecordatoriosDeCita(pool, rows[0]!.id, {
      ahora: instanteDesdeLocal('2026-10-01', '09:00', CDMX),
      momentos: ['t_7'],
    });

    const aviso = (await avisosDelDia(pool, '2026-10-15'))[0]!;
    expect(aviso.canalPreferido).toBe('whatsapp');
    expect(aviso.enlaceCorreo).toBeNull();
    expect(aviso.asunto).toBeNull();
  });

  it('marcar enviado guarda por qué canal salió', async () => {
    const usuaria = await crearUsuaria(pool, { horaAvisoDia: '08:00' });
    await pool.query(`UPDATE usuaria SET correo = 'ana@ejemplo.com', canal_preferido = 'correo' WHERE id = $1`, [
      usuaria.id,
    ]);
    const mascotaId = await crearMascota(pool, usuaria.id);
    const proveedorId = await crearProveedor(pool);
    const iniciaEn = instanteDesdeLocal('2026-10-22', '11:00', CDMX);

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en, costo_confirmado)
       VALUES ($1,$2,$3,'bano','confirmada',$4,450) RETURNING id`,
      [usuaria.id, mascotaId, proveedorId, iniciaEn],
    );
    await programarRecordatoriosDeCita(pool, rows[0]!.id, {
      ahora: instanteDesdeLocal('2026-10-01', '09:00', CDMX),
      momentos: ['t_7'],
    });

    const aviso = (await avisosDelDia(pool, '2026-10-15'))[0]!;
    const r = await panel(`/panel/api/avisos/${aviso.id}/enviado`, {
      method: 'POST',
      payload: { texto: aviso.texto, canal: 'correo' },
    });
    expect(r.statusCode).toBe(200);

    const { rows: guardado } = await pool.query<{ canal: string; estado: string }>(
      `SELECT canal, estado FROM recordatorio WHERE id = $1`,
      [aviso.id],
    );
    expect(guardado[0]).toMatchObject({ canal: 'correo_manual', estado: 'enviado' });
  });
});
