import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CDMX,
  casosAbiertos,
  crearCita,
  crearUsuaria,
  escenarioBasico,
  limpiar,
  prepararBase,
  recordatoriosDe,
  relojEn,
} from '../ayuda/db.js';
import { WhatsAppFalso } from '../../src/channels/whatsapp/index.js';
import {
  MAX_INTENTOS,
  TOLERANCIA_MINUTOS,
  barrerRecordatorios,
  cancelarRecordatoriosPendientes,
  programarRecordatoriosDeCita,
  registrarEstadoDeEntrega,
  reprogramarRecordatorios,
} from '../../src/modules/recordatorios/servicio.js';
import { instanteDesdeLocal } from '../../src/domain/tiempo.js';
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

const ANTES = instanteDesdeLocal('2026-09-20', '09:00', CDMX);

/**
 * Los momentos que se programan al CONFIRMAR una cita.
 *
 * El aviso de T-21 no entra: lo crea el disparo de la rutina (RF-08) y ya salio
 * cuando la cita se confirma. Programar los cinco aqui haria que cualquier
 * barrido posterior a T-21 sacara tambien ese aviso, que es justo lo que no
 * pasa en el flujo real de la seccion 03.
 */
const TRAS_CONFIRMAR = ['t_7', 't_3', 't_0', 'cierre'] as const;

function trasConfirmar(citaId: string, ahora = ANTES) {
  return programarRecordatoriosDeCita(pool, citaId, { ahora, momentos: TRAS_CONFIRMAR });
}

describe('programacion de recordatorios (RF-12)', () => {
  it('crea los cinco momentos de una cita confirmada', async () => {
    const { citaId } = await escenarioBasico(pool);
    const insertados = await programarRecordatoriosDeCita(pool, citaId, { ahora: ANTES });

    expect(insertados).toBe(5);
    const filas = await recordatoriosDe(pool, citaId);
    expect(filas.map((f) => f.momento)).toEqual(['t_21', 't_7', 't_3', 't_0', 'cierre']);
    expect(filas.every((f) => f.estado === 'programado')).toBe(true);
  });

  it('es idempotente: volver a programar no duplica avisos', async () => {
    const { citaId } = await escenarioBasico(pool);
    await programarRecordatoriosDeCita(pool, citaId, { ahora: ANTES });
    const segundos = await programarRecordatoriosDeCita(pool, citaId, { ahora: ANTES });

    expect(segundos).toBe(0);
    expect(await recordatoriosDe(pool, citaId)).toHaveLength(5);
  });

  it('respeta los recordatorios que la usuaria apago (RF-13)', async () => {
    const { citaId, usuaria } = await escenarioBasico(pool);
    await pool.query(
      `INSERT INTO recordatorio_desactivado (usuaria_id, momento) VALUES ($1,'t_3'),($1,'t_7')`,
      [usuaria.id],
    );

    await programarRecordatoriosDeCita(pool, citaId, { ahora: ANTES });
    const filas = await recordatoriosDe(pool, citaId);
    expect(filas.map((f) => f.momento)).toEqual(['t_21', 't_0', 'cierre']);
  });

  it('no programa nada para una cita cancelada', async () => {
    const { citaId } = await escenarioBasico(pool);
    await pool.query(`UPDATE cita SET estado = 'cancelada' WHERE id = $1`, [citaId]);
    expect(await programarRecordatoriosDeCita(pool, citaId, { ahora: ANTES })).toBe(0);
  });
});

describe('barrido y envio', () => {
  it('manda el aviso con los cuatro datos y guarda lo que se envio', async () => {
    const { citaId, usuaria, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    const cuandoToca = instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' });
    const reloj = relojEn(cuandoToca);
    const resumen = await barrerRecordatorios({ pool, whatsapp, reloj });

    expect(resumen).toMatchObject({ enviados: 1, fallidos: 0, fueraDeTolerancia: 0 });
    expect(whatsapp.enviados).toHaveLength(1);

    const mensaje = whatsapp.ultimoPara(usuaria.celular)!;
    expect(mensaje.texto).toContain('baño');
    expect(mensaje.texto).toContain('22 de octubre');
    expect(mensaje.texto).toContain('11:00');
    expect(mensaje.texto).toContain('Petco Polanco');
    expect(mensaje.texto).toContain('$450');

    const fila = (await recordatoriosDe(pool, citaId)).find((f) => f.momento === 't_7')!;
    expect(fila.estado).toBe('enviado');
    expect(fila.contenido_enviado).toBe(mensaje.texto);
    expect(fila.plantilla).toBe('huella_recordatorio_v1');
    expect(fila.id_externo).toBe(mensaje.idExterno);
    expect(fila.retraso_segundos).toBe(0);
  });

  it('dice "costo por confirmar" cuando el proveedor no dio precio (seccion 05)', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool, { costo: null });
    await trasConfirmar(citaId);

    const reloj = relojEn(instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' }));
    await barrerRecordatorios({ pool, whatsapp, reloj });

    expect(whatsapp.enviados[0]!.texto).toContain('Costo por confirmar');
  });

  it('no manda dos veces el mismo aviso', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    const reloj = relojEn(instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' }));
    await barrerRecordatorios({ pool, whatsapp, reloj });
    const segundo = await barrerRecordatorios({ pool, whatsapp, reloj });

    expect(segundo.enviados).toBe(0);
    expect(whatsapp.enviados).toHaveLength(1);
  });

  it('un barrido atrasado saca todo lo pendiente de golpe', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    // El trabajador estuvo caido y arranca el mismo dia de la cita.
    const reloj = relojEn(instanteDesdeLocal('2026-10-22', '09:00', CDMX));
    const resumen = await barrerRecordatorios({ pool, whatsapp, reloj });

    // T-7, T-3 y T-0 ya vencieron; el cierre todavia no.
    expect(resumen.enviados).toBe(3);
    expect(resumen.fueraDeTolerancia).toBe(3);
    expect(iniciaEn.getTime()).toBeGreaterThan(reloj.ahora().getTime());
  });

  it('cancela el aviso de una cita que se cancelo entre tanto', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);
    await pool.query(`UPDATE cita SET estado = 'cancelada' WHERE id = $1`, [citaId]);

    const reloj = relojEn(instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' }));
    const resumen = await barrerRecordatorios({ pool, whatsapp, reloj });

    expect(resumen).toMatchObject({ enviados: 0, cancelados: 1 });
    expect(whatsapp.enviados).toHaveLength(0);
  });

  it('no manda un recordatorio de una cita que ya paso, y lo reporta', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    // El barrido vuelve a la vida dos dias despues de la cita.
    const reloj = relojEn(new Date(iniciaEn.getTime() + 2 * 24 * 60 * 60 * 1000));
    const resumen = await barrerRecordatorios({ pool, whatsapp, reloj });

    // Solo sale el cierre, que es posterior a la cita.
    expect(whatsapp.enviados).toHaveLength(1);
    expect(whatsapp.enviados[0]!.plantilla).toBe('huella_cierre_v1');
    expect(resumen.cancelados).toBe(3);

    const casos = await casosAbiertos(pool);
    expect(casos.filter((c) => c.motivo === 'envio_fallido').length).toBe(3);
  });
});

describe('RNF-03: tolerancia de 15 minutos', () => {
  it('registra el retraso real de cada envio', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    const cuandoToca = instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' });
    const reloj = relojEn(new Date(cuandoToca.getTime() + 4 * 60_000));
    await barrerRecordatorios({ pool, whatsapp, reloj });

    const fila = (await recordatoriosDe(pool, citaId)).find((f) => f.momento === 't_7')!;
    expect(fila.retraso_segundos).toBe(240);
    expect((await casosAbiertos(pool)).length).toBe(0);
  });

  it('abre un caso cuando un aviso sale fuera de tolerancia', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    const cuandoToca = instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' });
    const reloj = relojEn(new Date(cuandoToca.getTime() + (TOLERANCIA_MINUTOS + 1) * 60_000));
    const resumen = await barrerRecordatorios({ pool, whatsapp, reloj });

    expect(resumen.fueraDeTolerancia).toBe(1);
    const casos = await casosAbiertos(pool);
    expect(casos.some((c) => c.motivo === 'envio_fuera_de_tolerancia')).toBe(true);
    // El aviso igual salio: tarde es mejor que nunca, pero queda anotado.
    expect(whatsapp.enviados).toHaveLength(1);
  });
});

describe('RNF-04: reintento de envios fallidos', () => {
  it('reintenta con espera creciente y acaba enviando', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    const cuandoToca = instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' });
    const reloj = relojEn(cuandoToca);
    whatsapp.fallasPendientes = 2;

    const primero = await barrerRecordatorios({ pool, whatsapp, reloj });
    expect(primero.fallidos).toBe(1);

    let fila = (await recordatoriosDe(pool, citaId)).find((f) => f.momento === 't_7')!;
    expect(fila.estado).toBe('fallido');
    expect(fila.intentos).toBe(1);
    expect(fila.proximo_intento_en).not.toBeNull();
    // El reintento NO mueve la hora programada: es contra ella que se mide RNF-03.
    expect(fila.programado_para.getTime()).toBe(cuandoToca.getTime());

    // Antes de que toque el reintento no se intenta nada.
    reloj.avanzarMinutos(0.5);
    expect((await barrerRecordatorios({ pool, whatsapp, reloj })).fallidos).toBe(0);

    reloj.avanzarMinutos(2);
    await barrerRecordatorios({ pool, whatsapp, reloj });
    reloj.avanzarMinutos(3);
    const tercero = await barrerRecordatorios({ pool, whatsapp, reloj });

    expect(tercero.enviados).toBe(1);
    fila = (await recordatoriosDe(pool, citaId)).find((f) => f.momento === 't_7')!;
    expect(fila.estado).toBe('enviado');
    expect(fila.intentos).toBe(3);
  });

  it('todos los reintentos caben dentro de la tolerancia de RNF-03', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    const cuandoToca = instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' });
    const reloj = relojEn(cuandoToca);
    whatsapp.fallasPendientes = MAX_INTENTOS;

    for (let i = 0; i < MAX_INTENTOS; i++) {
      await barrerRecordatorios({ pool, whatsapp, reloj });
      reloj.avanzarMinutos(5);
    }

    const fila = (await recordatoriosDe(pool, citaId)).find((f) => f.momento === 't_7')!;
    expect(fila.intentos).toBe(MAX_INTENTOS);
    // Se agotaron los intentos antes de que se acabara la tolerancia.
    expect(fila.proximo_intento_en).toBeNull();
  });

  it('avisa al panel interno cuando el aviso no salio (RNF-04)', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    const reloj = relojEn(instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' }));
    whatsapp.fallaPermanente = true;
    await barrerRecordatorios({ pool, whatsapp, reloj });

    const casos = await casosAbiertos(pool);
    expect(casos).toHaveLength(1);
    expect(casos[0]!.motivo).toBe('envio_fallido');
    expect(casos[0]!.estado).toBe('abierto');

    const fila = (await recordatoriosDe(pool, citaId)).find((f) => f.momento === 't_7')!;
    // Un fallo no reintentable no espera: no tiene caso gastar cuota.
    expect(fila.intentos).toBe(1);
    expect(fila.proximo_intento_en).toBeNull();
  });
});

describe('reagendar y cancelar (RF-11)', () => {
  it('recalcula los avisos pendientes y conserva los ya enviados', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    // Sale el T-7.
    const reloj = relojEn(instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' }));
    await barrerRecordatorios({ pool, whatsapp, reloj });
    expect(whatsapp.enviados).toHaveLength(1);

    // La cita se mueve una semana.
    const nuevaFecha = instanteDesdeLocal('2026-10-29', '11:00', CDMX);
    await pool.query(`UPDATE cita SET inicia_en = $2 WHERE id = $1`, [citaId, nuevaFecha]);
    await reprogramarRecordatorios(pool, citaId, { ahora: reloj.ahora() });

    const filas = await recordatoriosDe(pool, citaId);
    const enviados = filas.filter((f) => f.estado === 'enviado');
    expect(enviados.map((f) => f.momento)).toEqual(['t_7']);

    const t3 = filas.find((f) => f.momento === 't_3')!;
    expect(t3.estado).toBe('programado');
    expect(t3.programado_para.getTime()).toBe(
      instanteDelMomento('t_3', { iniciaEn: nuevaFecha, zona: CDMX, horaAvisoDia: '08:00' }).getTime(),
    );
  });

  it('apaga los avisos pendientes al cancelar', async () => {
    const { citaId } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    const apagados = await cancelarRecordatoriosPendientes(pool, citaId);
    expect(apagados).toBe(4);
    expect((await recordatoriosDe(pool, citaId)).every((f) => f.estado === 'cancelado')).toBe(true);
  });
});

describe('RF-15: entrega y lectura', () => {
  it('registra entregado y leido, y no retrocede', async () => {
    const { citaId, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);

    const reloj = relojEn(instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' }));
    await barrerRecordatorios({ pool, whatsapp, reloj });
    const idExterno = whatsapp.enviados[0]!.idExterno;

    expect(await registrarEstadoDeEntrega(pool, idExterno, 'entregado', new Date())).toBe(true);
    expect(await registrarEstadoDeEntrega(pool, idExterno, 'leido', new Date())).toBe(true);
    // Un "entregado" que llega tarde no debe bajar el estado de "leido".
    expect(await registrarEstadoDeEntrega(pool, idExterno, 'entregado', new Date())).toBe(false);

    const fila = (await recordatoriosDe(pool, citaId)).find((f) => f.momento === 't_7')!;
    expect(fila.estado).toBe('leido');
  });
});

describe('no se le escribe a una usuaria dada de baja', () => {
  it('omite avisos de usuarias anonimizadas (seccion 09)', async () => {
    const { citaId, usuaria, iniciaEn } = await escenarioBasico(pool);
    await trasConfirmar(citaId);
    await pool.query(`UPDATE usuaria SET anonimizada_en = now() WHERE id = $1`, [usuaria.id]);

    const reloj = relojEn(instanteDelMomento('t_7', { iniciaEn, zona: CDMX, horaAvisoDia: '08:00' }));
    const resumen = await barrerRecordatorios({ pool, whatsapp, reloj });

    expect(resumen.enviados).toBe(0);
    expect(whatsapp.enviados).toHaveLength(0);
  });
});
