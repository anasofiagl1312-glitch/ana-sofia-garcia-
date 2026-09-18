/**
 * Alta, acceso, perfil y derechos ARCO (RF-01, RF-03, RF-13, RF-23, seccion 09).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Servicios } from '../servidor.js';
import { VERSION_AVISO_PRIVACIDAD } from '../servidor.js';
import { crearSesion, revocarSesiones, solicitarCodigo, verificarCodigo } from '../../modules/auth/servicio.js';
import { validarZonaHoraria } from '../../domain/tiempo.js';
import { MOMENTOS_DESACTIVABLES, esDesactivable } from '../../domain/agenda.js';
import {
  borrarDatosDeUsuaria,
  exportarDatos,
  registrarConsentimiento,
} from '../../modules/privacidad/servicio.js';
import {
  cancelarSuscripcion,
  estadoDeSuscripcion,
  iniciarSuscripcion,
} from '../../modules/suscripcion/servicio.js';

const esquemaCelular = z.object({ celular: z.string().min(8, 'Falta el número de celular.') });

const esquemaVerificacion = z.object({
  celular: z.string().min(8),
  codigo: z.string().regex(/^\d{6}$/, 'El código es de seis dígitos.'),
  nombre: z.string().trim().min(1).max(80).optional(),
  zonaHoraria: z.string().optional(),
  aceptaAvisoPrivacidad: z.literal(true, {
    errorMap: () => ({ message: 'Hay que aceptar el aviso de privacidad para crear la cuenta.' }),
  }),
});

const esquemaPerfil = z.object({
  nombre: z.string().trim().min(1).max(80).nullish(),
  zonaHoraria: z.string().optional(),
  horaAvisoDia: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const esquemaPreferencias = z.object({
  preferencias: z
    .array(
      z.object({
        diaSemana: z.number().int().min(1).max(7),
        horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
        horaFin: z.string().regex(/^\d{2}:\d{2}$/),
        prioridad: z.number().int().min(1).default(1),
      }),
    )
    .max(21),
});

export async function registrarRutasAuth(app: FastifyInstance, s: Servicios): Promise<void> {
  /** RF-01, paso 1: pedir el codigo. */
  app.post('/auth/codigo', async (peticion) => {
    const { celular } = esquemaCelular.parse(peticion.body);
    const resultado = await solicitarCodigo(s.pool, celular);

    // El codigo se manda por WhatsApp, que es el canal del producto.
    await s.whatsapp.enviarTexto({
      a: resultado.celular,
      texto: `Tu código de Huella es ${resultado.codigo}. Vence en 10 minutos.`,
    });

    // Nunca se devuelve el codigo al cliente: quien lo pide tiene que poder
    // recibirlo en ese numero. En desarrollo se lee del canal falso.
    return { enviado: true, expiraEn: resultado.expiraEn };
  });

  /** RF-01, paso 2: verificar y entrar. */
  app.post('/auth/verificar', async (peticion) => {
    const datos = esquemaVerificacion.parse(peticion.body);
    if (datos.zonaHoraria) validarZonaHoraria(datos.zonaHoraria);

    const verificada = await verificarCodigo(s.pool, datos.celular, datos.codigo, {
      versionAvisoPrivacidad: VERSION_AVISO_PRIVACIDAD,
      nombre: datos.nombre ?? null,
      ...(datos.zonaHoraria ? { zonaHoraria: datos.zonaHoraria } : {}),
    });

    if (verificada.esNueva) {
      await iniciarSuscripcion(s.pool, verificada.usuariaId, {
        diasPrueba: s.config.cobros.diasPrueba,
        precioMensual: s.config.cobros.precioMensual,
        pasarela: s.pasarela,
      });
    }

    const token = await crearSesion(s.pool, verificada.usuariaId);
    return { token, esNueva: verificada.esNueva, avisoPrivacidad: VERSION_AVISO_PRIVACIDAD };
  });

  app.register(async (protegidas) => {
    protegidas.addHook('preHandler', app.autenticarUsuaria);

    protegidas.get('/yo', async (peticion) => {
      const { rows } = await s.pool.query(
        `SELECT id, celular, nombre, zona_horaria, hora_aviso_dia, estado, creada_en
           FROM usuaria WHERE id = $1`,
        [peticion.usuariaId],
      );
      const desactivados = await s.pool.query<{ momento: string }>(
        `SELECT momento FROM recordatorio_desactivado WHERE usuaria_id = $1`,
        [peticion.usuariaId],
      );
      const suscripcion = await estadoDeSuscripcion(s.pool, peticion.usuariaId!);
      return {
        usuaria: rows[0],
        recordatoriosDesactivados: desactivados.rows.map((r) => r.momento),
        suscripcion,
      };
    });

    protegidas.patch('/yo', async (peticion) => {
      const datos = esquemaPerfil.parse(peticion.body);
      if (datos.zonaHoraria) validarZonaHoraria(datos.zonaHoraria);

      await s.pool.query(
        `UPDATE usuaria
            SET nombre = COALESCE($2, nombre),
                zona_horaria = COALESCE($3, zona_horaria),
                hora_aviso_dia = COALESCE($4::time, hora_aviso_dia),
                actualizada_en = now()
          WHERE id = $1`,
        [peticion.usuariaId, datos.nombre ?? null, datos.zonaHoraria ?? null, datos.horaAvisoDia ?? null],
      );
      return { actualizado: true };
    });

    /** RF-03: preferencias de agenda. Se reemplazan en bloque. */
    protegidas.put('/yo/preferencias', async (peticion) => {
      const { preferencias } = esquemaPreferencias.parse(peticion.body);
      for (const p of preferencias) {
        if (p.horaFin <= p.horaInicio) {
          throw Object.assign(new Error('La hora de fin debe ser posterior a la de inicio.'), { statusCode: 400 });
        }
      }

      await s.pool.query(`DELETE FROM preferencia_agenda WHERE usuaria_id = $1`, [peticion.usuariaId]);
      for (const p of preferencias) {
        await s.pool.query(
          `INSERT INTO preferencia_agenda (usuaria_id, dia_semana, hora_inicio, hora_fin, prioridad)
           VALUES ($1,$2,$3,$4,$5)`,
          [peticion.usuariaId, p.diaSemana, p.horaInicio, p.horaFin, p.prioridad],
        );
      }
      return { guardadas: preferencias.length };
    });

    /** RF-13: apagar o encender un recordatorio. */
    protegidas.put('/yo/recordatorios/:momento', async (peticion) => {
      const { momento } = z.object({ momento: z.string() }).parse(peticion.params);
      const { activo } = z.object({ activo: z.boolean() }).parse(peticion.body);

      if (!esDesactivable(momento as never)) {
        throw Object.assign(
          new Error(`Solo se pueden desactivar: ${MOMENTOS_DESACTIVABLES.join(', ')}.`),
          { statusCode: 400 },
        );
      }

      if (activo) {
        await s.pool.query(
          `DELETE FROM recordatorio_desactivado WHERE usuaria_id = $1 AND momento = $2::momento_recordatorio`,
          [peticion.usuariaId, momento],
        );
      } else {
        await s.pool.query(
          `INSERT INTO recordatorio_desactivado (usuaria_id, momento)
           VALUES ($1,$2::momento_recordatorio) ON CONFLICT DO NOTHING`,
          [peticion.usuariaId, momento],
        );
      }
      return { momento, activo };
    });

    /**
     * Consentimiento para actuar en su nombre (seccion 09). Se pide aparte del
     * aviso de privacidad porque autoriza algo distinto: compartir su nombre y
     * el de su mascota con un tercero.
     */
    protegidas.post('/yo/consentimientos', async (peticion) => {
      const datos = z
        .object({
          tipo: z.enum(['representacion', 'grabacion_llamadas']),
          version: z.string().default(VERSION_AVISO_PRIVACIDAD),
        })
        .parse(peticion.body);

      await registrarConsentimiento(s.pool, peticion.usuariaId!, datos);
      return { registrado: true };
    });

    /** Derecho de acceso. */
    protegidas.get('/yo/exportacion', async (peticion) => exportarDatos(s.pool, peticion.usuariaId!));

    /** Derecho de cancelacion: baja de la suscripcion y borrado de datos. */
    protegidas.delete('/yo', async (peticion) => {
      await cancelarSuscripcion(s.pool, peticion.usuariaId!, { pasarela: s.pasarela });
      const resultado = await borrarDatosDeUsuaria(s.pool, peticion.usuariaId!, { almacen: s.almacen });
      await revocarSesiones(s.pool, peticion.usuariaId!);
      return { borrado: true, ...resultado };
    });

    /** RF-23: baja de suscripcion, sin borrar los datos. */
    protegidas.delete('/suscripcion', async (peticion) => {
      const { sirveHasta } = await cancelarSuscripcion(s.pool, peticion.usuariaId!, { pasarela: s.pasarela });
      return { cancelada: true, sirveHasta };
    });
  });
}
