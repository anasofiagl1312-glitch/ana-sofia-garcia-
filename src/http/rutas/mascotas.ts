/**
 * Mascotas, documentos, carnet e historial (RF-02, RF-16 a RF-18, RF-21).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Servicios } from '../servidor.js';
import { validarDocumento } from '../../modules/almacenamiento/index.js';
import { carnetDeMascota, generarPdfCarnet } from '../../modules/carnet/servicio.js';

const esquemaMascota = z.object({
  nombre: z.string().trim().min(1).max(60),
  especie: z.enum(['perro', 'gato', 'otra']),
  raza: z.string().trim().max(60).nullish(),
  nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  nacimientoPrecision: z.enum(['dia', 'mes', 'anio']).default('dia'),
  pesoKg: z.number().positive().max(200).nullish(),
  sexo: z.enum(['macho', 'hembra', 'desconocido']).default('desconocido'),
  esterilizada: z.boolean().nullish(),
  notasManejo: z.string().trim().max(1000).nullish(),
});

const esquemaAplicacion = z.object({
  producto: z.string().trim().min(1).max(120),
  marca: z.string().trim().max(80).nullish(),
  lote: z.string().trim().max(60).nullish(),
  fechaAplicacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaRefuerzo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  veterinario: z.string().trim().max(120).nullish(),
  cedulaProfesional: z.string().trim().max(40).nullish(),
  tipoServicio: z.string().trim().max(40).nullish(),
  citaId: z.string().uuid().nullish(),
  documentoId: z.string().uuid().nullish(),
});

const idEnRuta = z.object({ id: z.string().uuid('Identificador inválido.') });

export async function registrarRutasMascotas(app: FastifyInstance, s: Servicios): Promise<void> {
  app.register(async (rutas) => {
    rutas.addHook('preHandler', app.autenticarUsuaria);

    /** RF-02 */
    rutas.post('/mascotas', async (peticion, respuesta) => {
      const d = esquemaMascota.parse(peticion.body);
      const { rows } = await s.pool.query<{ id: string }>(
        `INSERT INTO mascota (usuaria_id, nombre, especie, raza, nacimiento, nacimiento_precision,
                              peso_kg, sexo, esterilizada, notas_manejo)
         VALUES ($1,$2,$3::especie,$4,$5,$6,$7,$8::sexo_mascota,$9,$10)
         RETURNING id`,
        [
          peticion.usuariaId, d.nombre, d.especie, d.raza ?? null, d.nacimiento ?? null,
          d.nacimientoPrecision, d.pesoKg ?? null, d.sexo, d.esterilizada ?? null, d.notasManejo ?? null,
        ],
      );
      return respuesta.status(201).send({ id: rows[0]!.id });
    });

    rutas.get('/mascotas', async (peticion) => {
      const { rows } = await s.pool.query(
        `SELECT id, nombre, especie, raza, nacimiento, peso_kg, sexo, esterilizada, notas_manejo
           FROM mascota WHERE usuaria_id = $1 AND archivada_en IS NULL ORDER BY creada_en`,
        [peticion.usuariaId],
      );
      return { mascotas: rows };
    });

    rutas.patch('/mascotas/:id', async (peticion) => {
      const { id } = idEnRuta.parse(peticion.params);
      const d = esquemaMascota.partial().parse(peticion.body);
      const { rowCount } = await s.pool.query(
        `UPDATE mascota
            SET nombre = COALESCE($3, nombre),
                raza = COALESCE($4, raza),
                peso_kg = COALESCE($5, peso_kg),
                esterilizada = COALESCE($6, esterilizada),
                notas_manejo = COALESCE($7, notas_manejo),
                actualizada_en = now()
          WHERE id = $1 AND usuaria_id = $2`,
        [id, peticion.usuariaId, d.nombre ?? null, d.raza ?? null, d.pesoKg ?? null,
         d.esterilizada ?? null, d.notasManejo ?? null],
      );
      if (rowCount === 0) throw Object.assign(new Error('No se encontró la mascota.'), { statusCode: 404 });
      return { actualizado: true };
    });

    /**
     * RF-18: el carnet.
     *
     * Responde con ETag. Si el cliente vuelve con la misma version, recibe 304
     * y usa lo que ya tiene guardado: asi abre al instante y sigue abriendo sin
     * senal, que es el requisito que importa en el mostrador (RNF-05).
     */
    rutas.get('/mascotas/:id/carnet', async (peticion, respuesta) => {
      const { id } = idEnRuta.parse(peticion.params);
      const carnet = await carnetDeMascota(s.pool, id, peticion.usuariaId!);

      const etag = `"${carnet.version}"`;
      if (peticion.headers['if-none-match'] === etag) return respuesta.status(304).send();

      return respuesta
        .header('ETag', etag)
        // `private`: es un documento con datos personales, ningun intermediario
        // debe guardarlo. `must-revalidate` deja que el cliente lo use de su
        // cache mientras confirma que sigue vigente.
        .header('Cache-Control', 'private, max-age=0, must-revalidate')
        .send(carnet);
    });

    rutas.get('/mascotas/:id/carnet.pdf', async (peticion, respuesta) => {
      const { id } = idEnRuta.parse(peticion.params);
      const carnet = await carnetDeMascota(s.pool, id, peticion.usuariaId!);
      const pdf = await generarPdfCarnet(carnet);
      return respuesta
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="carnet-${carnet.mascota.nombre}.pdf"`)
        .send(pdf);
    });

    /** RF-16: carga de documentos por foto o PDF. */
    rutas.post('/mascotas/:id/documentos', async (peticion, respuesta) => {
      const { id } = idEnRuta.parse(peticion.params);

      const { rowCount } = await s.pool.query(
        `SELECT 1 FROM mascota WHERE id = $1 AND usuaria_id = $2`,
        [id, peticion.usuariaId],
      );
      if (rowCount === 0) throw Object.assign(new Error('No se encontró la mascota.'), { statusCode: 404 });

      const archivo = await peticion.file();
      if (!archivo) throw Object.assign(new Error('No llegó ningún archivo.'), { statusCode: 400 });

      const contenido = await archivo.toBuffer();
      validarDocumento(archivo.mimetype, contenido.byteLength);

      const tipo = z
        .enum(['carnet', 'receta', 'estudio', 'comprobante', 'foto', 'otro'])
        .catch('otro')
        .parse((archivo.fields?.['tipo'] as { value?: string } | undefined)?.value);

      const ruta = `${peticion.usuariaId}/${id}/${randomUUID()}`;
      const guardado = await s.almacen.guardar(ruta, contenido);

      const { rows } = await s.pool.query<{ id: string }>(
        `INSERT INTO documento (usuaria_id, mascota_id, tipo, ruta_archivo, nombre_original,
                                tipo_mime, bytes, sha256)
         VALUES ($1,$2,$3::tipo_documento,$4,$5,$6,$7,$8)
         RETURNING id`,
        [peticion.usuariaId, id, tipo, guardado.ruta, archivo.filename ?? null,
         archivo.mimetype, guardado.bytes, guardado.sha256],
      );

      return respuesta.status(201).send({ id: rows[0]!.id, bytes: guardado.bytes, tipo });
    });

    rutas.get('/documentos/:id/archivo', async (peticion, respuesta) => {
      const { id } = idEnRuta.parse(peticion.params);
      const { rows } = await s.pool.query<{ ruta_archivo: string; tipo_mime: string; nombre_original: string | null }>(
        `SELECT ruta_archivo, tipo_mime, nombre_original FROM documento WHERE id = $1 AND usuaria_id = $2`,
        [id, peticion.usuariaId],
      );
      const doc = rows[0];
      if (!doc) throw Object.assign(new Error('No se encontró el documento.'), { statusCode: 404 });

      const contenido = await s.almacen.leer(doc.ruta_archivo);
      return respuesta
        .header('Content-Type', doc.tipo_mime)
        .header('Cache-Control', 'private, max-age=0, must-revalidate')
        .send(contenido);
    });

    /** RF-17: registro estructurado de aplicaciones. */
    rutas.post('/mascotas/:id/aplicaciones', async (peticion, respuesta) => {
      const { id } = idEnRuta.parse(peticion.params);
      const d = esquemaAplicacion.parse(peticion.body);

      const { rowCount } = await s.pool.query(
        `SELECT 1 FROM mascota WHERE id = $1 AND usuaria_id = $2`,
        [id, peticion.usuariaId],
      );
      if (rowCount === 0) throw Object.assign(new Error('No se encontró la mascota.'), { statusCode: 404 });

      if (d.fechaRefuerzo && d.fechaRefuerzo < d.fechaAplicacion) {
        throw Object.assign(
          new Error('La fecha de refuerzo no puede ser anterior a la de aplicación.'),
          { statusCode: 400 },
        );
      }

      const { rows } = await s.pool.query<{ id: string }>(
        `INSERT INTO aplicacion (mascota_id, cita_id, documento_id, tipo_servicio, producto, marca, lote,
                                 fecha_aplicacion, fecha_refuerzo, veterinario, cedula_profesional)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [id, d.citaId ?? null, d.documentoId ?? null, d.tipoServicio ?? null, d.producto,
         d.marca ?? null, d.lote ?? null, d.fechaAplicacion, d.fechaRefuerzo ?? null,
         d.veterinario ?? null, d.cedulaProfesional ?? null],
      );
      return respuesta.status(201).send({ id: rows[0]!.id });
    });

    /** RF-21: historial por mascota con costo real y proveedor. */
    rutas.get('/mascotas/:id/historial', async (peticion) => {
      const { id } = idEnRuta.parse(peticion.params);
      const { rows } = await s.pool.query(
        `SELECT c.id, c.inicia_en, c.estado, c.costo_confirmado, c.costo_real,
                ts.nombre AS servicio,
                CASE WHEN p.sucursal IS NULL OR p.sucursal = '' THEN p.negocio
                     ELSE p.negocio || ' ' || p.sucursal END AS proveedor
           FROM cita c
           JOIN proveedor p      ON p.id = c.proveedor_id
           JOIN tipo_servicio ts ON ts.codigo = c.tipo_servicio
          WHERE c.mascota_id = $1 AND c.usuaria_id = $2
          ORDER BY c.inicia_en DESC`,
        [id, peticion.usuariaId],
      );
      return { historial: rows };
    });
  });
}
