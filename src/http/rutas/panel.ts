/**
 * Panel interno (RF-24). Autenticacion por rol y bitacora de consultas (RNF-06).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Servicios } from '../servidor.js';
import {
  type Operador,
  bandejaDeExcepciones,
  citasDelDia,
  conversacionesDeCita,
  citasProximas,
  estadoDeSuscripciones,
  resolverCaso,
  saludDeEnvios,
} from '../../modules/panel/servicio.js';
import { proveedoresCompartidos } from '../../modules/proveedores/servicio.js';
import { borrarDatosDeUsuaria, exportarDatos } from '../../modules/privacidad/servicio.js';
import { conBitacora } from '../../modules/panel/servicio.js';
import { altaDeClienta, listarClientas } from '../../modules/panel/alta.js';
import { avisosDelDia, marcarEnviadoAMano } from '../../modules/panel/avisos.js';
import { numerosDelPiloto } from '../../modules/panel/numeros.js';
import { cerrarCita } from '../../modules/agendamiento/servicio.js';
import { VERSION_AVISO_PRIVACIDAD } from '../servidor.js';

/**
 * Acceso del equipo interno.
 *
 * En Fase 1 el equipo son unas pocas personas, asi que se resuelve con
 * credenciales guardadas en `usuario_interno` en vez de montar un proveedor de
 * identidad. Lo que NO se simplifica es el control por rol ni la bitacora, que
 * es lo que pide RNF-06.
 */
async function autenticarOperador(s: Servicios, peticion: FastifyRequest): Promise<Operador> {
  const cabecera = peticion.headers.authorization;
  const [esquema, valor] = (cabecera ?? '').split(' ');
  if (esquema?.toLowerCase() !== 'bearer' || !valor) {
    throw Object.assign(new Error('Falta la credencial del panel.'), { statusCode: 401 });
  }

  const [correo, secreto] = Buffer.from(valor, 'base64').toString('utf8').split(':');
  if (!correo || !secreto) {
    throw Object.assign(new Error('Credencial mal formada.'), { statusCode: 401 });
  }

  const { rows } = await s.pool.query<{ id: string; nombre: string; rol: Operador['rol']; contrasena_hash: string }>(
    `SELECT id, nombre, rol, contrasena_hash FROM usuario_interno WHERE correo = $1 AND activo`,
    [correo],
  );
  const usuario = rows[0];
  if (!usuario) throw Object.assign(new Error('Credencial inválida.'), { statusCode: 401 });

  const esperado = Buffer.from(usuario.contrasena_hash, 'hex');
  const recibido = createHash('sha256').update(secreto).digest();
  if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) {
    throw Object.assign(new Error('Credencial inválida.'), { statusCode: 401 });
  }

  return { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol };
}

const esquemaAlta = z.object({
  clienta: z.object({
    nombre: z.string().trim().min(1, 'Falta el nombre de la clienta.').max(80),
    celular: z.string().trim().min(8, 'Falta el celular.'),
    zonaHoraria: z.string().optional(),
    horaAvisoDia: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }),
  mascota: z.object({
    nombre: z.string().trim().min(1, 'Falta el nombre de la mascota.').max(60),
    especie: z.enum(['perro', 'gato', 'otra']),
    raza: z.string().trim().max(60).nullish(),
    pesoKg: z.number().positive().max(200).nullish(),
    sexo: z.enum(['macho', 'hembra', 'desconocido']).optional(),
    notasManejo: z.string().trim().max(1000).nullish(),
  }),
  proveedor: z.object({
    negocio: z.string().trim().min(1, 'Falta el nombre del negocio.').max(120),
    sucursal: z.string().trim().max(120).nullish(),
    direccion: z.string().trim().max(300).nullish(),
    telefono: z.string().trim().max(30).nullish(),
    whatsapp: z.string().trim().max(30).nullish(),
  }),
  rutina: z.object({
    tipoServicio: z.string().trim().min(1).max(40),
    frecuenciaCantidad: z.number().int().positive().max(52),
    frecuenciaUnidad: z.enum(['semanas', 'meses']),
    costoReferencia: z.number().nonnegative().nullish(),
    horaPreferida: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    proximaFechaEstimada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  preferencias: z
    .array(
      z.object({
        diaSemana: z.number().int().min(1).max(7),
        horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
        horaFin: z.string().regex(/^\d{2}:\d{2}$/),
        prioridad: z.number().int().min(1).default(1),
      }),
    )
    .max(21)
    .optional(),
});

export async function registrarRutasPanel(app: FastifyInstance, s: Servicios): Promise<void> {
  app.register(
    async (panel) => {
      panel.addHook('preHandler', async (peticion) => {
        peticion.operador = await autenticarOperador(s, peticion);
      });

      /**
       * Citas. Con `fecha`, las de ese día; sin ella, las próximas.
       *
       * La pestaña de Citas quiere ver lo que viene, no solo lo de hoy.
       */
      panel.get('/citas', async (peticion) => {
        const { fecha } = z
          .object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
          .parse(peticion.query);

        if (fecha) {
          return { fecha, citas: await citasDelDia(s.pool, peticion.operador!, fecha) };
        }
        return { fecha: null, citas: await citasProximas(s.pool, peticion.operador!) };
      });

      /** La operadora mandó el aviso a mano desde su WhatsApp (Fase 1). */
      panel.post('/avisos/:id/enviado', async (peticion) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
        const { texto } = z.object({ texto: z.string().min(1) }).parse(peticion.body);

        const marcado = await conBitacora(
          s.pool,
          peticion.operador!,
          'ver_bandeja',
          { accion: 'modificacion', entidad: 'recordatorio', entidadId: id },
          () => marcarEnviadoAMano(s.pool, id, { texto, operadorId: peticion.operador!.id }),
        );

        if (!marcado) {
          throw Object.assign(new Error('Ese aviso ya no estaba pendiente.'), { statusCode: 409 });
        }
        return { enviado: true };
      });

      /** Cierre de T+1 desde el panel: la cita se cumplió. */
      panel.post('/citas/:id/cumplida', async (peticion) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
        const { costoReal } = z
          .object({ costoReal: z.number().nonnegative().nullish() })
          .parse(peticion.body ?? {});

        return conBitacora(
          s.pool,
          peticion.operador!,
          'resolver_caso',
          { accion: 'modificacion', entidad: 'cita', entidadId: id },
          () => cerrarCita(s.pool, id, { costoReal: costoReal ?? null }),
        );
      });

      /** Bandeja de excepciones (RF-10). */
      panel.get('/bandeja', async (peticion) => {
        const { incluirResueltos } = z
          .object({ incluirResueltos: z.coerce.boolean().default(false) })
          .parse(peticion.query);
        const casos = await bandejaDeExcepciones(s.pool, peticion.operador!, { incluirResueltos });
        return {
          casos,
          // El criterio de la seccion 12 pide que un caso aparezca en menos de
          // una hora; esto deja ver de un vistazo si alguno lleva mas.
          conMasDeUnaHora: casos.filter((c) => c.minutosAbierto > 60 && c.estado !== 'resuelto').length,
        };
      });

      panel.post('/casos/:id/resolver', async (peticion) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
        const { resolucion } = z.object({ resolucion: z.string().trim().min(1).max(1000) }).parse(peticion.body);
        await resolverCaso(s.pool, peticion.operador!, id, resolucion);
        return { resuelto: true };
      });

      /** Historial de conversaciones con proveedores (seccion 05). */
      panel.get('/citas/:id/conversaciones', async (peticion) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
        return { conversaciones: await conversacionesDeCita(s.pool, peticion.operador!, id) };
      });

      /** Estado de cada suscripcion. */
      panel.get('/suscripciones', async (peticion) => ({
        suscripciones: await estadoDeSuscripciones(s.pool, peticion.operador!),
      }));

      /** Salud de los envios: es la vista que comprueba RNF-03 y RNF-04. */
      panel.get('/salud-envios', async (peticion) => {
        const { ultimos } = z.object({ ultimos: z.coerce.number().int().positive().max(1000).default(50) })
          .parse(peticion.query);
        return saludDeEnvios(s.pool, peticion.operador!, { ultimos });
      });

      /**
       * Proveedores que ya comparten varias usuarias.
       *
       * No es una curiosidad: es la semilla del directorio de Fase 4 y la lista
       * de negocios que ya tienen un motivo para darse de alta, porque ya les
       * estan llegando citas (seccion 11).
       */
      panel.get('/proveedores-compartidos', async (peticion) => {
        return conBitacora(
          s.pool,
          peticion.operador!,
          'ver_expediente',
          { accion: 'consulta', entidad: 'proveedor' },
          async () => ({ proveedores: await proveedoresCompartidos(s.pool) }),
        );
      });

      /**
       * Pestaña «Hoy»: los avisos que tocan, con el texto ya redactado.
       *
       * En Fase 1 los manda la operadora a mano desde aquí (sección 10), así
       * que cada uno viene con su enlace de WhatsApp listo.
       */
      panel.get('/avisos-hoy', async (peticion) => {
        const { fecha } = z
          .object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
          .parse(peticion.query);
        const dia = fecha ?? new Date().toISOString().slice(0, 10);

        const avisos = await conBitacora(
          s.pool,
          peticion.operador!,
          'ver_expediente',
          { accion: 'consulta', entidad: 'recordatorio', detalle: { fecha: dia } },
          () => avisosDelDia(s.pool, dia),
        );

        return {
          fecha: dia,
          avisos,
          pendientes: avisos.filter((a) => ['programado', 'fallido'].includes(a.estado)).length,
          atrasados: avisos.filter((a) => a.atrasado).length,
        };
      });

      /** Alta de clienta, mascota y rutina en una sola captura. */
      panel.post('/clientas', async (peticion, respuesta) => {
        const datos = esquemaAlta.parse(peticion.body);

        const resultado = await conBitacora(
          s.pool,
          peticion.operador!,
          'alta_clienta',
          { accion: 'modificacion', entidad: 'usuaria', detalle: { alta: true } },
          () =>
            altaDeClienta(s.pool, datos, {
              versionAvisoPrivacidad: VERSION_AVISO_PRIVACIDAD,
              operadorId: peticion.operador!.id,
              pasarela: s.pasarela,
              diasPrueba: s.config.cobros.diasPrueba,
              precioMensual: s.config.cobros.precioMensual,
            }),
        );

        return respuesta.status(201).send(resultado);
      });

      panel.get('/clientas', async (peticion) => ({
        clientas: await conBitacora(
          s.pool,
          peticion.operador!,
          'ver_expediente',
          { accion: 'consulta', entidad: 'usuaria' },
          () => listarClientas(s.pool),
        ),
      }));

      /**
       * Pestaña «Números»: los siete del piloto, con las palabras de la
       * referencia. Se acompañan de la salud de envíos, que es la que responde
       * el criterio de aceptación de RNF-03.
       */
      panel.get('/numeros', async (peticion) => {
        const [numeros, envios] = await Promise.all([
          conBitacora(
            s.pool,
            peticion.operador!,
            'ver_bandeja',
            { accion: 'consulta', entidad: 'panel_numeros' },
            () => numerosDelPiloto(s.pool),
          ),
          saludDeEnvios(s.pool, peticion.operador!, { ultimos: 50 }),
        ]);
        return { ...numeros, envios };
      });

      /** Derechos ARCO atendidos por el equipo (seccion 09). */
      panel.get('/usuarias/:id/exportacion', async (peticion) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
        return conBitacora(
          s.pool,
          peticion.operador!,
          'exportar_datos',
          { accion: 'exportacion', entidad: 'usuaria', entidadId: id, usuariaAfectadaId: id },
          () => exportarDatos(s.pool, id),
        );
      });

      panel.delete('/usuarias/:id', async (peticion) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
        return conBitacora(
          s.pool,
          peticion.operador!,
          'borrar_datos',
          { accion: 'borrado', entidad: 'usuaria', entidadId: id, usuariaAfectadaId: id },
          () => borrarDatosDeUsuaria(s.pool, id, { almacen: s.almacen }),
        );
      });
    },
    // La API vive bajo /panel/api; /panel sirve la interfaz (archivos estáticos).
    { prefix: '/panel/api' },
  );
}
