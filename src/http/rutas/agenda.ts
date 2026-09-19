/**
 * Proveedores, rutinas y citas (RF-04 a RF-07, RF-11).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Servicios } from '../servidor.js';
import { registrarProveedorDeUsuaria } from '../../modules/proveedores/servicio.js';
import { opcionesDeHorario } from '../../modules/agendamiento/preferencias.js';
import {
  cerrarCita,
  confirmarCita,
  reagendarCita,
  registrarEleccionDeHorario,
} from '../../modules/agendamiento/servicio.js';
import {
  cancelarRecordatoriosPendientes,
  programarRecordatoriosDeCita,
} from '../../modules/recordatorios/servicio.js';
import { instanteDesdeLocal } from '../../domain/tiempo.js';
import { sumarFrecuencia } from '../../domain/tiempo.js';

const idEnRuta = z.object({ id: z.string().uuid('Identificador inválido.') });

const esquemaProveedor = z.object({
  negocio: z.string().trim().min(1).max(120),
  sucursal: z.string().trim().max(120).nullish(),
  direccion: z.string().trim().max(300).nullish(),
  telefono: z.string().trim().max(30).nullish(),
  whatsapp: z.string().trim().max(30).nullish(),
  canalPreferido: z.enum(['whatsapp', 'telefono', 'integracion']).optional(),
  latitud: z.number().min(-90).max(90).nullish(),
  longitud: z.number().min(-180).max(180).nullish(),
  alias: z.string().trim().max(80).nullish(),
  notas: z.string().trim().max(500).nullish(),
  // Qué es este negocio para ella. Vive en el vínculo y no en el proveedor,
  // que es compartido entre clientas (sección 11).
  relacion: z.enum(['veterinaria', 'estetica', 'guarderia', 'paseador', 'otro']).optional(),
});

const esquemaRutina = z.object({
  mascotaId: z.string().uuid(),
  proveedorId: z.string().uuid(),
  tipoServicio: z.string().trim().min(1).max(40),
  frecuenciaCantidad: z.number().int().positive().max(52),
  frecuenciaUnidad: z.enum(['semanas', 'meses']),
  costoReferencia: z.number().nonnegative().nullish(),
  diasAnticipacion: z.number().int().positive().max(90).default(21),
  horaPreferida: z.string().regex(/^\d{2}:\d{2}$/).default('10:00'),
  proximaFechaEstimada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const esquemaCitaPuntual = z.object({
  mascotaId: z.string().uuid(),
  proveedorId: z.string().uuid(),
  tipoServicio: z.string().trim().min(1).max(40),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  costoConfirmado: z.number().nonnegative().nullish(),
  indicaciones: z.string().trim().max(500).nullish(),
});

async function zonaDe(s: Servicios, usuariaId: string): Promise<string> {
  const { rows } = await s.pool.query<{ zona_horaria: string }>(
    `SELECT zona_horaria FROM usuaria WHERE id = $1`,
    [usuariaId],
  );
  return rows[0]?.zona_horaria ?? s.config.zonaHorariaPorDefecto;
}

export async function registrarRutasAgenda(app: FastifyInstance, s: Servicios): Promise<void> {
  /** RF-06: catalogo de tipos de servicio. Publico: no trae datos personales. */
  app.get('/catalogo/servicios', async () => {
    const { rows } = await s.pool.query(
      `SELECT codigo, nombre, periodicidad_dias, genera_aplicacion FROM tipo_servicio ORDER BY orden`,
    );
    return { servicios: rows };
  });

  app.register(async (rutas) => {
    rutas.addHook('preHandler', app.autenticarUsuaria);

    /** RF-04: alta de proveedor. Reusa el negocio si ya existe (seccion 11). */
    rutas.post('/proveedores', async (peticion, respuesta) => {
      const d = esquemaProveedor.parse(peticion.body);
      const resultado = await registrarProveedorDeUsuaria(s.pool, peticion.usuariaId!, d, {
        alias: d.alias ?? null,
        notas: d.notas ?? null,
        ...(d.relacion ? { relacion: d.relacion } : {}),
      });
      return respuesta.status(resultado.yaExistia ? 200 : 201).send(resultado);
    });

    rutas.get('/proveedores', async (peticion) => {
      const { rows } = await s.pool.query(
        `SELECT p.id, p.negocio, p.sucursal, p.direccion, p.telefono, p.whatsapp,
                p.canal_preferido, up.alias, up.notas, up.relacion
           FROM usuaria_proveedor up JOIN proveedor p ON p.id = up.proveedor_id
          WHERE up.usuaria_id = $1
          ORDER BY p.negocio`,
        [peticion.usuariaId],
      );
      return { proveedores: rows };
    });

    /** RF-05: alta de rutina recurrente. */
    rutas.post('/rutinas', async (peticion, respuesta) => {
      const d = esquemaRutina.parse(peticion.body);

      // Si no dice cuando toca la primera, se calcula sumando la frecuencia a
      // hoy: es lo que la usuaria quiere decir con "cada mes" al darla de alta.
      const proxima =
        d.proximaFechaEstimada ??
        sumarFrecuencia(new Date().toISOString().slice(0, 10), d.frecuenciaCantidad, d.frecuenciaUnidad);

      const { rows } = await s.pool.query<{ id: string }>(
        `INSERT INTO rutina (usuaria_id, mascota_id, proveedor_id, tipo_servicio,
                             frecuencia_cantidad, frecuencia_unidad, costo_referencia,
                             dias_anticipacion, hora_preferida, proxima_fecha_estimada)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
          WHERE EXISTS (SELECT 1 FROM mascota WHERE id = $2 AND usuaria_id = $1)
         RETURNING id`,
        [peticion.usuariaId, d.mascotaId, d.proveedorId, d.tipoServicio, d.frecuenciaCantidad,
         d.frecuenciaUnidad, d.costoReferencia ?? null, d.diasAnticipacion, d.horaPreferida, proxima],
      );
      if (!rows[0]) throw Object.assign(new Error('No se encontró la mascota.'), { statusCode: 404 });
      return respuesta.status(201).send({ id: rows[0].id, proximaFechaEstimada: proxima });
    });

    rutas.get('/rutinas', async (peticion) => {
      const { rows } = await s.pool.query(
        `SELECT r.id, r.tipo_servicio, ts.nombre AS servicio, r.frecuencia_cantidad, r.frecuencia_unidad,
                r.costo_referencia, r.dias_anticipacion, r.proxima_fecha_estimada, r.activa,
                m.nombre AS mascota, p.negocio, p.sucursal
           FROM rutina r
           JOIN mascota m        ON m.id = r.mascota_id
           JOIN proveedor p      ON p.id = r.proveedor_id
           JOIN tipo_servicio ts ON ts.codigo = r.tipo_servicio
          WHERE r.usuaria_id = $1
          ORDER BY r.proxima_fecha_estimada`,
        [peticion.usuariaId],
      );
      return { rutinas: rows };
    });

    rutas.patch('/rutinas/:id', async (peticion) => {
      const { id } = idEnRuta.parse(peticion.params);
      const d = z
        .object({
          activa: z.boolean().optional(),
          costoReferencia: z.number().nonnegative().nullish(),
          diasAnticipacion: z.number().int().positive().max(90).optional(),
        })
        .parse(peticion.body);

      const { rowCount } = await s.pool.query(
        `UPDATE rutina
            SET activa = COALESCE($3, activa),
                costo_referencia = COALESCE($4, costo_referencia),
                dias_anticipacion = COALESCE($5, dias_anticipacion),
                actualizada_en = now()
          WHERE id = $1 AND usuaria_id = $2`,
        [id, peticion.usuariaId, d.activa ?? null, d.costoReferencia ?? null, d.diasAnticipacion ?? null],
      );
      if (rowCount === 0) throw Object.assign(new Error('No se encontró la rutina.'), { statusCode: 404 });
      return { actualizado: true };
    });

    /** Opciones de horario que se le ofrecerian hoy (RF-03), para previsualizar. */
    rutas.get('/rutinas/:id/opciones', async (peticion) => {
      const { id } = idEnRuta.parse(peticion.params);
      const { rows } = await s.pool.query<{ proxima_fecha_estimada: string; zona_horaria: string }>(
        `SELECT r.proxima_fecha_estimada, u.zona_horaria
           FROM rutina r JOIN usuaria u ON u.id = r.usuaria_id
          WHERE r.id = $1 AND r.usuaria_id = $2`,
        [id, peticion.usuariaId],
      );
      const rutina = rows[0];
      if (!rutina) throw Object.assign(new Error('No se encontró la rutina.'), { statusCode: 404 });

      const { rows: preferencias } = await s.pool.query(
        `SELECT dia_semana AS "diaSemana", hora_inicio AS "horaInicio",
                hora_fin AS "horaFin", prioridad
           FROM preferencia_agenda WHERE usuaria_id = $1 ORDER BY prioridad`,
        [peticion.usuariaId],
      );

      return {
        opciones: opcionesDeHorario(
          preferencias as never,
          rutina.proxima_fecha_estimada,
          rutina.zona_horaria,
        ),
      };
    });

    /** RF-07: cita de una sola vez, sin rutina asociada. */
    rutas.post('/citas', async (peticion, respuesta) => {
      const d = esquemaCitaPuntual.parse(peticion.body);
      const zona = await zonaDe(s, peticion.usuariaId!);
      const iniciaEn = instanteDesdeLocal(d.fecha, d.hora, zona);

      const { rows } = await s.pool.query<{ id: string }>(
        `INSERT INTO cita (usuaria_id, mascota_id, proveedor_id, tipo_servicio, estado,
                           inicia_en, costo_confirmado, indicaciones)
         SELECT $1,$2,$3,$4,'confirmada',$5,$6,$7
          WHERE EXISTS (SELECT 1 FROM mascota WHERE id = $2 AND usuaria_id = $1)
         RETURNING id`,
        [peticion.usuariaId, d.mascotaId, d.proveedorId, d.tipoServicio, iniciaEn,
         d.costoConfirmado ?? null, d.indicaciones ?? null],
      );
      if (!rows[0]) throw Object.assign(new Error('No se encontró la mascota.'), { statusCode: 404 });

      await programarRecordatoriosDeCita(s.pool, rows[0].id, {
        momentos: ['t_7', 't_3', 't_0', 'cierre'],
      });
      return respuesta.status(201).send({ id: rows[0].id, iniciaEn });
    });

    rutas.get('/citas', async (peticion) => {
      const { rows } = await s.pool.query(
        `SELECT c.id, c.inicia_en, c.estado, c.costo_confirmado, c.costo_real, c.indicaciones,
                ts.nombre AS servicio, m.nombre AS mascota,
                CASE WHEN p.sucursal IS NULL OR p.sucursal = '' THEN p.negocio
                     ELSE p.negocio || ' ' || p.sucursal END AS proveedor,
                p.direccion
           FROM cita c
           JOIN mascota m        ON m.id = c.mascota_id
           JOIN proveedor p      ON p.id = c.proveedor_id
           JOIN tipo_servicio ts ON ts.codigo = c.tipo_servicio
          WHERE c.usuaria_id = $1 AND c.estado NOT IN ('cancelada','reagendada')
          ORDER BY c.inicia_en`,
        [peticion.usuariaId],
      );
      return { citas: rows };
    });

    /** La usuaria elige una de las opciones de T-21. */
    rutas.post('/citas/:id/horario', async (peticion) => {
      const { id } = idEnRuta.parse(peticion.params);
      const d = z
        .object({
          fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          hora: z.string().regex(/^\d{2}:\d{2}$/),
        })
        .parse(peticion.body);

      await asegurarPropiedad(s, id, peticion.usuariaId!);
      const zona = await zonaDe(s, peticion.usuariaId!);
      await registrarEleccionDeHorario(s.pool, id, instanteDesdeLocal(d.fecha, d.hora, zona));
      return { estado: 'por_confirmar_con_proveedor' };
    });

    /** El proveedor aparto: se confirma y salen T-7, T-3 y T-0. */
    rutas.post('/citas/:id/confirmar', async (peticion) => {
      const { id } = idEnRuta.parse(peticion.params);
      const d = z
        .object({
          fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          hora: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          costoConfirmado: z.number().nonnegative().nullish(),
          indicaciones: z.string().trim().max(500).nullish(),
        })
        .parse(peticion.body);

      await asegurarPropiedad(s, id, peticion.usuariaId!);
      const zona = await zonaDe(s, peticion.usuariaId!);

      await confirmarCita(s.pool, id, {
        ...(d.fecha && d.hora ? { iniciaEn: instanteDesdeLocal(d.fecha, d.hora, zona) } : {}),
        costoConfirmado: d.costoConfirmado ?? null,
        indicaciones: d.indicaciones ?? null,
      });
      return { estado: 'confirmada' };
    });

    /** RF-11: reagendar desde la conversacion. */
    rutas.post('/citas/:id/reagendar', async (peticion) => {
      const { id } = idEnRuta.parse(peticion.params);
      const d = z
        .object({
          fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          hora: z.string().regex(/^\d{2}:\d{2}$/),
        })
        .parse(peticion.body);

      await asegurarPropiedad(s, id, peticion.usuariaId!);
      const zona = await zonaDe(s, peticion.usuariaId!);
      await reagendarCita(s.pool, id, instanteDesdeLocal(d.fecha, d.hora, zona));
      return { reagendada: true };
    });

    /** RF-11: cancelar. */
    rutas.post('/citas/:id/cancelar', async (peticion) => {
      const { id } = idEnRuta.parse(peticion.params);
      const { motivo } = z.object({ motivo: z.string().trim().max(300).optional() }).parse(peticion.body ?? {});

      await asegurarPropiedad(s, id, peticion.usuariaId!);
      await s.pool.query(
        `UPDATE cita SET estado = 'cancelada', motivo_cancelacion = $2, actualizada_en = now()
          WHERE id = $1 AND estado NOT IN ('cumplida','cancelada','reagendada')`,
        [id, motivo ?? null],
      );
      const apagados = await cancelarRecordatoriosPendientes(s.pool, id);
      return { cancelada: true, recordatoriosApagados: apagados };
    });

    /** Cierre de T+1: se cumplio y se registra el costo real. */
    rutas.post('/citas/:id/cerrar', async (peticion) => {
      const { id } = idEnRuta.parse(peticion.params);
      const { costoReal } = z
        .object({ costoReal: z.number().nonnegative().nullish() })
        .parse(peticion.body ?? {});

      await asegurarPropiedad(s, id, peticion.usuariaId!);
      const resultado = await cerrarCita(s.pool, id, { costoReal: costoReal ?? null });
      return { cumplida: true, ...resultado };
    });
  });
}

async function asegurarPropiedad(s: Servicios, citaId: string, usuariaId: string): Promise<void> {
  const { rowCount } = await s.pool.query(`SELECT 1 FROM cita WHERE id = $1 AND usuaria_id = $2`, [
    citaId,
    usuariaId,
  ]);
  if (rowCount === 0) throw Object.assign(new Error('No se encontró la cita.'), { statusCode: 404 });
}
