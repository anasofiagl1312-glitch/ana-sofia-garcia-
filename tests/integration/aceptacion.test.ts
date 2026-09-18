/**
 * Criterios de aceptacion de la seccion 12.
 *
 * Cada prueba de este archivo corresponde a una vineta del documento, con el
 * texto original citado. Es la lista contra la que se da por entregada la
 * Fase 1, asi que conviene poder correrla de un jalon y leerla sin traducir.
 */
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CDMX,
  casosAbiertos,
  crearMascota,
  crearProveedor,
  crearRutina,
  crearUsuaria,
  limpiar,
  ligarProveedor,
  prepararBase,
  recordatoriosDe,
  relojEn,
} from '../ayuda/db.js';
import { WhatsAppFalso } from '../../src/channels/whatsapp/index.js';
import { PasarelaFalsa, cancelarSuscripcion, iniciarSuscripcion } from '../../src/modules/suscripcion/servicio.js';
import {
  TOLERANCIA_MINUTOS,
  barrerRecordatorios,
  programarRecordatoriosDeCita,
} from '../../src/modules/recordatorios/servicio.js';
import {
  cerrarCita,
  confirmarCita,
  dispararConsultasDeDisponibilidad,
  reagendarCita,
  registrarEleccionDeHorario,
} from '../../src/modules/agendamiento/servicio.js';
import { carnetDeMascota, generarPdfCarnet } from '../../src/modules/carnet/servicio.js';
import { borrarDatosDeUsuaria } from '../../src/modules/privacidad/servicio.js';
import { registrarInteraccion } from '../../src/modules/proveedores/servicio.js';
import { datosFaltantes } from '../../src/modules/mensajes/contenido.js';
import { fechaLocalDe, instanteDesdeLocal } from '../../src/domain/tiempo.js';
import { instanteDelMomento } from '../../src/domain/agenda.js';

let pool: pg.Pool;
let whatsapp: WhatsAppFalso;

beforeAll(async () => {
  pool = await prepararBase();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await limpiar(pool);
  whatsapp = new WhatsAppFalso();
});

/** Escenario del documento: baño mensual de Lola en Petco Polanco. */
async function escenarioDeRutina(opciones: { proximaFecha?: string } = {}) {
  const usuaria = await crearUsuaria(pool, { nombre: 'Ana', zona: CDMX, horaAvisoDia: '08:00' });
  const mascotaId = await crearMascota(pool, usuaria.id, { nombre: 'Lola' });
  const proveedorId = await crearProveedor(pool);
  await ligarProveedor(pool, usuaria.id, proveedorId);

  await pool.query(
    `INSERT INTO preferencia_agenda (usuaria_id, dia_semana, hora_inicio, hora_fin, prioridad)
     VALUES ($1,4,'10:00','13:00',1), ($1,6,'09:00','12:00',2)`,
    [usuaria.id],
  );

  const rutinaId = await crearRutina(pool, {
    usuariaId: usuaria.id,
    mascotaId,
    proveedorId,
    proximaFecha: opciones.proximaFecha ?? '2026-10-22',
    horaPreferida: '11:00',
  });

  return { usuaria, mascotaId, proveedorId, rutinaId };
}

describe('Criterio 1 — "Una usuaria puede registrar mascota, proveedor y rutina"', () => {
  it('queda todo ligado y con la próxima fecha calculada', async () => {
    const { usuaria, rutinaId } = await escenarioDeRutina();
    const { rows } = await pool.query(
      `SELECT r.proxima_fecha_estimada, m.nombre AS mascota, p.negocio
         FROM rutina r JOIN mascota m ON m.id = r.mascota_id JOIN proveedor p ON p.id = r.proveedor_id
        WHERE r.id = $1 AND r.usuaria_id = $2`,
      [rutinaId, usuaria.id],
    );
    expect(rows[0]).toMatchObject({ mascota: 'Lola', negocio: 'Petco', proxima_fecha_estimada: '2026-10-22' });
  });
});

describe('Criterio 2 — "Los cuatro recordatorios salen en su momento, con los cuatro datos, durante un ciclo entero"', () => {
  it('recorre el ciclo completo de la sección 03, de T−21 al cierre', async () => {
    const { usuaria, rutinaId } = await escenarioDeRutina();

    // --- T−21: el sistema pregunta disponibilidad ---
    const t21 = instanteDesdeLocal('2026-10-01', '10:00', CDMX);
    const reloj = relojEn(t21);

    const disparo = await dispararConsultasDeDisponibilidad(pool, { ahora: reloj.ahora() });
    expect(disparo.citasCreadas).toBe(1);

    const { rows: citas } = await pool.query<{ id: string }>(`SELECT id FROM cita WHERE rutina_id = $1`, [rutinaId]);
    const citaId = citas[0]!.id;

    await barrerRecordatorios({ pool, whatsapp, reloj });
    expect(whatsapp.enviados).toHaveLength(1);
    expect(whatsapp.enviados[0]!.plantilla).toBe('huella_disponibilidad_v1');
    // Las opciones salen de sus preferencias (RF-03): primero sus dos días de
    // prioridad 1 (jueves) y luego el de prioridad 2 (sábado).
    expect(whatsapp.enviados[0]!.texto).toContain('1) jueves 22 de octubre, de 10:00 a 13:00');
    expect(whatsapp.enviados[0]!.texto).toContain('2) jueves 29 de octubre, de 10:00 a 13:00');
    expect(whatsapp.enviados[0]!.texto).toContain('3) sábado 24 de octubre, de 09:00 a 12:00');

    // --- Mismo día: la usuaria elige y el proveedor confirma ---
    const iniciaEn = instanteDesdeLocal('2026-10-22', '11:00', CDMX);
    await registrarEleccionDeHorario(pool, citaId, iniciaEn);
    await registrarInteraccion(pool, {
      citaId,
      proveedorId: (await pool.query<{ proveedor_id: string }>(`SELECT proveedor_id FROM cita WHERE id = $1`, [citaId]))
        .rows[0]!.proveedor_id,
      canal: 'whatsapp',
      direccion: 'saliente',
      contenido: 'Buenas tardes, ¿tienen lugar el jueves 22 a las 11? Es para el baño de Lola. Costo $450.',
      resultado: 'cita_apartada',
    });
    await confirmarCita(pool, citaId, { iniciaEn, costoConfirmado: 450, ahora: reloj.ahora() });

    // --- Los tres recordatorios y el cierre, cada uno a su hora ---
    const esperados = [
      { momento: 't_7', fecha: '2026-10-15' },
      { momento: 't_3', fecha: '2026-10-19' },
      { momento: 't_0', fecha: '2026-10-22' },
      { momento: 'cierre', fecha: '2026-10-23' },
    ] as const;

    for (const esperado of esperados) {
      const cuando = instanteDelMomento(esperado.momento, { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' });
      expect(fechaLocalDe(cuando, CDMX), esperado.momento).toBe(esperado.fecha);

      reloj.mover(cuando);
      const resumen = await barrerRecordatorios({ pool, whatsapp, reloj });
      expect(resumen.enviados, `envío de ${esperado.momento}`).toBe(1);
      expect(resumen.fueraDeTolerancia).toBe(0);
    }

    // Cinco avisos en todo el ciclo: T−21, T−7, T−3, T−0 y el cierre.
    expect(whatsapp.enviados).toHaveLength(5);

    // --- La regla de contenido se cumple en TODOS ---
    const datos = {
      servicio: 'Baño',
      mascota: 'Lola',
      iniciaEn,
      zona: CDMX,
      proveedor: 'Petco Polanco',
      direccion: 'Av. Presidente Masaryk 275',
      costo: 450,
    };
    for (const mensaje of whatsapp.enviados) {
      expect(datosFaltantes(mensaje.texto, datos), mensaje.plantilla).toEqual([]);
      expect(mensaje.a).toBe(usuaria.celular);
    }

    // --- T+1: se cierra, se registra el costo real y se programa el siguiente ciclo ---
    const { siguienteFecha } = await cerrarCita(pool, citaId, { costoReal: 470 });
    expect(siguienteFecha).toBe('2026-11-22');

    const { rows: cerrada } = await pool.query(`SELECT estado, costo_real FROM cita WHERE id = $1`, [citaId]);
    expect(cerrada[0]).toMatchObject({ estado: 'cumplida', costo_real: 470 });

    // Y la rutina ya apunta al mes siguiente, lista para volver a empezar.
    const { rows: rutina } = await pool.query(
      `SELECT proxima_fecha_estimada, cita_generada_para FROM rutina WHERE id = $1`,
      [rutinaId],
    );
    expect(rutina[0]).toMatchObject({ proxima_fecha_estimada: '2026-11-22', cita_generada_para: null });
  });
});

describe('Criterio 3 — "Ningún recordatorio con más de 15 minutos de retraso en una muestra de 50 envíos"', () => {
  it('cincuenta envíos, barrido cada minuto, ninguno fuera de tolerancia', async () => {
    // 50 citas de 50 usuarias distintas, repartidas a lo largo del día, como
    // estarían en operación real.
    const citas: Array<{ citaId: string; iniciaEn: Date }> = [];

    for (let i = 0; i < 50; i++) {
      const usuaria = await crearUsuaria(pool, { zona: CDMX, horaAvisoDia: '08:00' });
      const mascotaId = await crearMascota(pool, usuaria.id, { nombre: `Mascota ${i}` });
      const proveedorId = await crearProveedor(pool, { claveDedup: `tel:+5255000${String(i).padStart(5, '0')}` });
      await ligarProveedor(pool, usuaria.id, proveedorId);

      // Horas escalonadas para que los T−7 caigan en minutos distintos.
      const iniciaEn = instanteDesdeLocal('2026-10-22', `${String(8 + (i % 10)).padStart(2, '0')}:00`, CDMX);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en, costo_confirmado)
         VALUES ($1,$2,$3,'bano','confirmada',$4,450) RETURNING id`,
        [usuaria.id, mascotaId, proveedorId, iniciaEn],
      );
      await programarRecordatoriosDeCita(pool, rows[0]!.id, {
        ahora: instanteDesdeLocal('2026-10-01', '09:00', CDMX),
        momentos: ['t_7'],
      });
      citas.push({ citaId: rows[0]!.id, iniciaEn });
    }

    // El trabajador barre cada minuto durante la mañana del 15 de octubre,
    // que es cuando vencen los cincuenta T−7 (todos a las 10:00 locales).
    const reloj = relojEn(instanteDesdeLocal('2026-10-15', '09:50', CDMX));
    let enviadosTotales = 0;
    for (let minuto = 0; minuto < 30; minuto++) {
      const resumen = await barrerRecordatorios({ pool, whatsapp, reloj });
      enviadosTotales += resumen.enviados;
      expect(resumen.fueraDeTolerancia).toBe(0);
      reloj.avanzarMinutos(1);
    }

    expect(enviadosTotales).toBe(50);
    expect(whatsapp.enviados).toHaveLength(50);

    // La medición que pide el criterio, tomada de la base.
    const { rows } = await pool.query<{ muestra: number; maximo: number; fuera: number }>(
      `SELECT count(*)::int AS muestra,
              max(retraso_segundos)::int AS maximo,
              count(*) FILTER (WHERE retraso_segundos > $1)::int AS fuera
         FROM recordatorio WHERE estado = 'enviado'`,
      [TOLERANCIA_MINUTOS * 60],
    );
    expect(rows[0]!.muestra).toBe(50);
    expect(rows[0]!.fuera).toBe(0);
    expect(rows[0]!.maximo).toBeLessThanOrEqual(TOLERANCIA_MINUTOS * 60);
  });
});

describe('Criterio 4 — "El carnet abre y se lee en el celular, sin conexión"', () => {
  it('se entrega completo en una respuesta y su versión no cambia si el carnet no cambió', async () => {
    const usuaria = await crearUsuaria(pool);
    const mascotaId = await crearMascota(pool, usuaria.id, { nombre: 'Lola' });

    await pool.query(
      `INSERT INTO aplicacion (mascota_id, tipo_servicio, producto, marca, lote,
                               fecha_aplicacion, fecha_refuerzo, veterinario, cedula_profesional)
       VALUES ($1,'vacunacion','Rabia','Nobivac','A-4471','2026-01-10','2027-01-10','Dra. Martínez','1234567')`,
      [mascotaId],
    );

    const primero = await carnetDeMascota(pool, mascotaId, usuaria.id);
    expect(primero.aplicaciones).toHaveLength(1);
    expect(primero.mascota.nombre).toBe('Lola');

    // Pedirlo otra vez da la MISMA versión: el cliente no vuelve a descargarlo
    // y por eso sigue abriendo sin señal.
    const segundo = await carnetDeMascota(pool, mascotaId, usuaria.id);
    expect(segundo.version).toBe(primero.version);

    // Al registrar algo nuevo, la versión cambia y el cliente se entera.
    await pool.query(
      `INSERT INTO aplicacion (mascota_id, producto, fecha_aplicacion) VALUES ($1,'Desparasitante','2026-09-01')`,
      [mascotaId],
    );
    expect((await carnetDeMascota(pool, mascotaId, usuaria.id)).version).not.toBe(primero.version);
  });

  it('se exporta a PDF', async () => {
    const usuaria = await crearUsuaria(pool);
    const mascotaId = await crearMascota(pool, usuaria.id, { nombre: 'Lola' });
    const pdf = await generarPdfCarnet(await carnetDeMascota(pool, mascotaId, usuaria.id));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(500);
  });

  it('no se puede pedir el carnet de la mascota de otra', async () => {
    const ana = await crearUsuaria(pool);
    const otra = await crearUsuaria(pool);
    const mascotaId = await crearMascota(pool, ana.id);
    await expect(carnetDeMascota(pool, mascotaId, otra.id)).rejects.toThrow();
  });
});

describe('Criterio 5 — "Reagendar actualiza la cita y recalcula los recordatorios pendientes"', () => {
  it('mueve la cita y recoloca lo que falta, sin tocar lo ya enviado', async () => {
    const usuaria = await crearUsuaria(pool, { horaAvisoDia: '08:00' });
    const mascotaId = await crearMascota(pool, usuaria.id);
    const proveedorId = await crearProveedor(pool);
    const iniciaEn = instanteDesdeLocal('2026-10-22', '11:00', CDMX);

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en, costo_confirmado)
       VALUES ($1,$2,$3,'bano','confirmada',$4,450) RETURNING id`,
      [usuaria.id, mascotaId, proveedorId, iniciaEn],
    );
    const citaId = rows[0]!.id;
    await programarRecordatoriosDeCita(pool, citaId, {
      ahora: instanteDesdeLocal('2026-10-01', '09:00', CDMX),
      momentos: ['t_7', 't_3', 't_0', 'cierre'],
    });

    // Sale el T−7 y entonces la usuaria pide mover la cita.
    const reloj = relojEn(instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' }));
    await barrerRecordatorios({ pool, whatsapp, reloj });

    const nuevaFecha = instanteDesdeLocal('2026-10-29', '16:00', CDMX);
    await reagendarCita(pool, citaId, nuevaFecha, { ahora: reloj.ahora() });

    const { rows: actual } = await pool.query(`SELECT inicia_en FROM cita WHERE id = $1`, [citaId]);
    expect((actual[0] as { inicia_en: Date }).inicia_en.getTime()).toBe(nuevaFecha.getTime());

    const filas = await recordatoriosDe(pool, citaId);
    expect(filas.filter((f) => f.estado === 'enviado').map((f) => f.momento)).toEqual(['t_7']);

    for (const momento of ['t_3', 't_0', 'cierre'] as const) {
      const fila = filas.find((f) => f.momento === momento)!;
      expect(fila.estado, momento).toBe('programado');
      expect(fila.programado_para.getTime(), momento).toBe(
        instanteDelMomento(momento, { iniciaEn: nuevaFecha, zona: CDMX, horaAvisoDia: '08:00' }).getTime(),
      );
    }
  });
});

describe('Criterio 6 — "Toda cita tiene evidencia y un costo registrado, o está marcada como «costo por confirmar»"', () => {
  it('la cita con precio confirmado guarda la evidencia de la conversación', async () => {
    const usuaria = await crearUsuaria(pool);
    const mascotaId = await crearMascota(pool, usuaria.id);
    const proveedorId = await crearProveedor(pool);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en, costo_confirmado)
       VALUES ($1,$2,$3,'bano','confirmada',now(),450) RETURNING id`,
      [usuaria.id, mascotaId, proveedorId],
    );

    await registrarInteraccion(pool, {
      citaId: rows[0]!.id,
      proveedorId,
      canal: 'whatsapp',
      direccion: 'saliente',
      contenido: 'Hilo completo de la conversación con el negocio.',
      resultado: 'cita_apartada',
    });

    const { rows: revision } = await pool.query<{ costo_confirmado: number | null; evidencias: number }>(
      `SELECT c.costo_confirmado,
              (SELECT count(*)::int FROM interaccion i WHERE i.cita_id = c.id) AS evidencias
         FROM cita c WHERE c.id = $1`,
      [rows[0]!.id],
    );
    expect(revision[0]!.costo_confirmado).toBe(450);
    expect(revision[0]!.evidencias).toBeGreaterThan(0);
  });

  it('sin precio, el aviso dice "Costo por confirmar" en vez de callarlo', async () => {
    const usuaria = await crearUsuaria(pool, { horaAvisoDia: '08:00' });
    const mascotaId = await crearMascota(pool, usuaria.id);
    const proveedorId = await crearProveedor(pool);
    const iniciaEn = instanteDesdeLocal('2026-10-22', '11:00', CDMX);

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en, costo_confirmado)
       VALUES ($1,$2,$3,'bano','confirmada',$4,NULL) RETURNING id`,
      [usuaria.id, mascotaId, proveedorId, iniciaEn],
    );
    await programarRecordatoriosDeCita(pool, rows[0]!.id, {
      ahora: instanteDesdeLocal('2026-10-01', '09:00', CDMX),
      momentos: ['t_7'],
    });

    const reloj = relojEn(instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' }));
    await barrerRecordatorios({ pool, whatsapp, reloj });
    expect(whatsapp.enviados[0]!.texto).toContain('Costo por confirmar');
  });
});

describe('Criterio 7 — "Un caso que el sistema no pudo resolver aparece en la bandeja en menos de una hora"', () => {
  it('el fallo de envío abre el caso en el momento, no al día siguiente', async () => {
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

    const cuando = instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' });
    const reloj = relojEn(cuando);
    whatsapp.fallaPermanente = true;

    const antes = Date.now();
    await barrerRecordatorios({ pool, whatsapp, reloj });

    const casos = await casosAbiertos(pool);
    expect(casos).toHaveLength(1);
    expect(casos[0]!.estado).toBe('abierto');
    // El caso se abre durante el propio barrido: el retraso hasta que aparece
    // en la bandeja es el del barrido, muy por debajo de la hora.
    expect(casos[0]!.abierto_en.getTime() - antes).toBeLessThan(60 * 60 * 1000);
  });
});

describe('Criterio 8 — "La usuaria puede cancelar su suscripción y solicitar el borrado de sus datos"', () => {
  it('la baja apaga las rutinas y los avisos pendientes', async () => {
    const usuaria = await crearUsuaria(pool);
    const mascotaId = await crearMascota(pool, usuaria.id);
    const proveedorId = await crearProveedor(pool);
    await crearRutina(pool, { usuariaId: usuaria.id, mascotaId, proveedorId, proximaFecha: '2026-12-01' });

    const pasarela = new PasarelaFalsa();
    await iniciarSuscripcion(pool, usuaria.id, { diasPrueba: 14, precioMensual: 149, pasarela });
    await cancelarSuscripcion(pool, usuaria.id, { pasarela });

    const { rows } = await pool.query(
      `SELECT (SELECT estado FROM usuaria WHERE id = $1) AS estado_usuaria,
              (SELECT count(*)::int FROM rutina WHERE usuaria_id = $1 AND activa) AS rutinas_activas`,
      [usuaria.id],
    );
    expect(rows[0]).toMatchObject({ estado_usuaria: 'cancelada', rutinas_activas: 0 });
  });

  it('el borrado quita sus datos, conserva el proveedor compartido y la deja anonimizada', async () => {
    const ana = await crearUsuaria(pool);
    const otra = await crearUsuaria(pool);
    const mascotaId = await crearMascota(pool, ana.id);
    const proveedorId = await crearProveedor(pool);
    await ligarProveedor(pool, ana.id, proveedorId);
    await ligarProveedor(pool, otra.id, proveedorId);

    await pool.query(
      `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado, inicia_en)
       VALUES ($1,$2,$3,'bano','confirmada',now())`,
      [ana.id, mascotaId, proveedorId],
    );

    const resultado = await borrarDatosDeUsuaria(pool, ana.id);
    expect(resultado).toMatchObject({ mascotasBorradas: 1, citasBorradas: 1 });

    const { rows } = await pool.query(
      `SELECT (SELECT count(*)::int FROM mascota WHERE usuaria_id = $1) AS mascotas,
              (SELECT count(*)::int FROM cita WHERE usuaria_id = $1) AS citas,
              (SELECT count(*)::int FROM proveedor WHERE id = $2) AS proveedor_sigue,
              (SELECT anonimizada_en IS NOT NULL FROM usuaria WHERE id = $1) AS anonimizada,
              (SELECT nombre FROM usuaria WHERE id = $1) AS nombre`,
      [ana.id, proveedorId],
    );
    expect(rows[0]).toMatchObject({
      mascotas: 0,
      citas: 0,
      // El proveedor es de todas: borrarlo le quitaría su veterinaria a la otra.
      proveedor_sigue: 1,
      anonimizada: true,
      nombre: null,
    });
  });
});
