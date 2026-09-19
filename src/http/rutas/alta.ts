/**
 * Alta de la clienta desde su propio teléfono.
 *
 * Entra por un enlace que la operadora le mandó a mano (ver
 * src/modules/alta/invitaciones.ts). El enlace se canjea UNA vez por una sesión
 * normal, y de ahí en adelante usa las mismas rutas que usaría la app de la
 * Fase 3: /yo, /mascotas, /proveedores. No hay una API paralela para esto.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Servicios } from '../servidor.js';
import { crearSesion } from '../../modules/auth/servicio.js';
import {
  canjearInvitacion,
  completarInvitacion,
  estadoDeInvitacion,
} from '../../modules/alta/invitaciones.js';

export async function registrarRutasAlta(app: FastifyInstance, s: Servicios): Promise<void> {
  /**
   * Canjea el enlace por una sesión.
   *
   * Devuelve de una vez lo que la primera pantalla necesita pintar, para que la
   * clienta no vea un formulario vacío mientras cargan tres peticiones más.
   */
  app.post('/alta/api/sesion', async (peticion) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(peticion.body);

    const { usuariaId } = await canjearInvitacion(s.pool, token);
    const sesion = await crearSesion(s.pool, usuariaId, { diasVigencia: 30 });

    const { rows } = await s.pool.query(
      `SELECT nombre, celular, correo, canal_preferido, zona_horaria, hora_aviso_dia
         FROM usuaria WHERE id = $1`,
      [usuariaId],
    );
    const u = rows[0] as {
      nombre: string | null;
      celular: string;
      correo: string | null;
      canal_preferido: string;
      zona_horaria: string;
      hora_aviso_dia: string;
    };

    const { rows: mascotas } = await s.pool.query(
      `SELECT id, nombre, especie, raza, peso_kg, sexo, esterilizada, nacimiento, notas_manejo
         FROM mascota WHERE usuaria_id = $1 AND archivada_en IS NULL ORDER BY creada_en`,
      [usuariaId],
    );

    const { rows: proveedores } = await s.pool.query(
      `SELECT p.id, p.negocio, p.sucursal, p.direccion, p.telefono, up.relacion
         FROM usuaria_proveedor up JOIN proveedor p ON p.id = up.proveedor_id
        WHERE up.usuaria_id = $1
        ORDER BY up.agregado_en`,
      [usuariaId],
    );

    const { rows: preferencias } = await s.pool.query(
      `SELECT dia_semana AS "diaSemana", hora_inicio AS "horaInicio",
              hora_fin AS "horaFin", prioridad
         FROM preferencia_agenda WHERE usuaria_id = $1 ORDER BY prioridad`,
      [usuariaId],
    );

    return {
      sesion,
      clienta: {
        nombre: u.nombre,
        celular: u.celular,
        correo: u.correo,
        canalPreferido: u.canal_preferido,
        zonaHoraria: u.zona_horaria,
        horaAvisoDia: String(u.hora_aviso_dia).slice(0, 5),
      },
      mascotas,
      proveedores,
      preferencias,
      // Si hay con qué leer el carnet. Sin esto la pantalla enseñaría un botón
      // de "leer solo" que siempre falla; con esto ofrece capturar a mano.
      puedeLeerCarnet: s.lectorDeCarnet.disponible,
    };
  });

  app.register(async (rutas) => {
    rutas.addHook('preHandler', app.autenticarUsuaria);

    /** La clienta dio por terminada su alta. */
    rutas.post('/alta/api/listo', async (peticion) => {
      await completarInvitacion(s.pool, peticion.usuariaId!);
      return { listo: true };
    });

    /** Para que pueda volver a abrir el enlace y ver en qué se quedó. */
    rutas.get('/alta/api/estado', async (peticion) => ({
      invitacion: await estadoDeInvitacion(s.pool, peticion.usuariaId!),
    }));
  });
}
