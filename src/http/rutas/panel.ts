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
  estadoDeSuscripciones,
  resolverCaso,
  saludDeEnvios,
} from '../../modules/panel/servicio.js';
import { proveedoresCompartidos } from '../../modules/proveedores/servicio.js';
import { borrarDatosDeUsuaria, exportarDatos } from '../../modules/privacidad/servicio.js';
import { conBitacora } from '../../modules/panel/servicio.js';

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

export async function registrarRutasPanel(app: FastifyInstance, s: Servicios): Promise<void> {
  app.register(
    async (panel) => {
      panel.addHook('preHandler', async (peticion) => {
        peticion.operador = await autenticarOperador(s, peticion);
      });

      /** Citas del dia. */
      panel.get('/citas', async (peticion) => {
        const { fecha } = z
          .object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
          .parse(peticion.query);
        const dia = fecha ?? new Date().toISOString().slice(0, 10);
        return { fecha: dia, citas: await citasDelDia(s.pool, peticion.operador!, dia) };
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
    { prefix: '/panel' },
  );
}
