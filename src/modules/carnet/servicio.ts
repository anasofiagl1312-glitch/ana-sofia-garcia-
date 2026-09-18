/**
 * Carnet de vacunacion digital (RF-16, RF-17, RF-18).
 *
 * RF-18 lo dice sin rodeos: "Es el momento de uso mas critico del producto: la
 * usuaria esta parada frente al mostrador, a veces con mala senal."
 *
 * De ahi salen las decisiones de este modulo:
 *
 *   - El carnet se entrega COMPLETO en una sola respuesta, sin paginar y sin
 *     llamadas encadenadas. Son decenas de renglones, no miles: cabe de sobra.
 *   - La respuesta trae una `version` (hash del contenido) que el cliente guarda
 *     junto con los datos. Si vuelve con la misma version, el servidor contesta
 *     304 y el cliente usa lo que ya tiene. Asi el carnet abre al instante y
 *     sigue abriendo sin senal (RNF-05).
 *   - La exportacion a PDF se genera en el servidor, para que sea identica a lo
 *     que se ve en pantalla y se pueda mandar por WhatsApp o imprimir.
 */
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import type { Ejecutor } from '../../db/pool.js';
import type { FechaLocal } from '../../domain/tiempo.js';
import { fechaLargaDeFechaLocal } from '../mensajes/formato.js';

export interface AplicacionDeCarnet {
  id: string;
  producto: string;
  marca: string | null;
  lote: string | null;
  fechaAplicacion: FechaLocal;
  fechaRefuerzo: FechaLocal | null;
  veterinario: string | null;
  cedulaProfesional: string | null;
  tipoServicio: string | null;
}

export interface DocumentoDeCarnet {
  id: string;
  tipo: string;
  nombreOriginal: string | null;
  tipoMime: string;
  bytes: number;
  cargadoEn: Date;
}

export interface Carnet {
  mascota: {
    id: string;
    nombre: string;
    especie: string;
    raza: string | null;
    nacimiento: FechaLocal | null;
    nacimientoPrecision: string;
    pesoKg: number | null;
    sexo: string;
    esterilizada: boolean | null;
    notasManejo: string | null;
  };
  duena: { nombre: string | null; celular: string };
  aplicaciones: AplicacionDeCarnet[];
  documentos: DocumentoDeCarnet[];
  /** Hash del contenido: cambia solo si el carnet cambio. */
  version: string;
  generadoEn: Date;
}

export class MascotaNoEncontrada extends Error {}

/**
 * Arma el carnet completo de una mascota.
 *
 * `usuariaId` no es opcional a proposito: el carnet es el documento mas
 * sensible del sistema y no debe existir una forma de pedirlo sin decir de
 * parte de quien.
 */
export async function carnetDeMascota(
  ejecutor: Ejecutor,
  mascotaId: string,
  usuariaId: string,
): Promise<Carnet> {
  const { rows: mascotas } = await ejecutor.query<{
    id: string;
    nombre: string;
    especie: string;
    raza: string | null;
    nacimiento: FechaLocal | null;
    nacimiento_precision: string;
    peso_kg: number | null;
    sexo: string;
    esterilizada: boolean | null;
    notas_manejo: string | null;
    duena_nombre: string | null;
    duena_celular: string;
  }>(
    `SELECT m.id, m.nombre, m.especie, m.raza, m.nacimiento, m.nacimiento_precision,
            m.peso_kg, m.sexo, m.esterilizada, m.notas_manejo,
            u.nombre AS duena_nombre, u.celular AS duena_celular
       FROM mascota m
       JOIN usuaria u ON u.id = m.usuaria_id
      WHERE m.id = $1 AND m.usuaria_id = $2 AND m.archivada_en IS NULL`,
    [mascotaId, usuariaId],
  );

  const m = mascotas[0];
  if (!m) throw new MascotaNoEncontrada(`No se encontró la mascota ${mascotaId}.`);

  const { rows: aplicaciones } = await ejecutor.query<{
    id: string;
    producto: string;
    marca: string | null;
    lote: string | null;
    fecha_aplicacion: FechaLocal;
    fecha_refuerzo: FechaLocal | null;
    veterinario: string | null;
    cedula_profesional: string | null;
    tipo_servicio: string | null;
  }>(
    `SELECT id, producto, marca, lote, fecha_aplicacion, fecha_refuerzo,
            veterinario, cedula_profesional, tipo_servicio
       FROM aplicacion
      WHERE mascota_id = $1
      ORDER BY fecha_aplicacion DESC, creada_en DESC`,
    [mascotaId],
  );

  const { rows: documentos } = await ejecutor.query<{
    id: string;
    tipo: string;
    nombre_original: string | null;
    tipo_mime: string;
    bytes: number;
    cargado_en: Date;
  }>(
    `SELECT id, tipo, nombre_original, tipo_mime, bytes, cargado_en
       FROM documento WHERE mascota_id = $1 ORDER BY cargado_en DESC`,
    [mascotaId],
  );

  const carnet: Omit<Carnet, 'version' | 'generadoEn'> = {
    mascota: {
      id: m.id,
      nombre: m.nombre,
      especie: m.especie,
      raza: m.raza,
      nacimiento: m.nacimiento,
      nacimientoPrecision: m.nacimiento_precision,
      pesoKg: m.peso_kg,
      sexo: m.sexo,
      esterilizada: m.esterilizada,
      notasManejo: m.notas_manejo,
    },
    duena: { nombre: m.duena_nombre, celular: m.duena_celular },
    aplicaciones: aplicaciones.map((a) => ({
      id: a.id,
      producto: a.producto,
      marca: a.marca,
      lote: a.lote,
      fechaAplicacion: a.fecha_aplicacion,
      fechaRefuerzo: a.fecha_refuerzo,
      veterinario: a.veterinario,
      cedulaProfesional: a.cedula_profesional,
      tipoServicio: a.tipo_servicio,
    })),
    documentos: documentos.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      nombreOriginal: d.nombre_original,
      tipoMime: d.tipo_mime,
      bytes: d.bytes,
      cargadoEn: d.cargado_en,
    })),
  };

  return { ...carnet, version: versionDe(carnet), generadoEn: new Date() };
}

/**
 * Version del carnet: hash de su contenido.
 *
 * Deliberadamente NO incluye la fecha de generacion. Si la incluyera, cambiaria
 * en cada peticion y el cliente volveria a descargar el carnet completo cada
 * vez, que es justo lo que no debe pasar cuando la usuaria esta en el mostrador
 * con mala senal.
 */
export function versionDe(carnet: Omit<Carnet, 'version' | 'generadoEn'>): string {
  return createHash('sha256').update(JSON.stringify(carnet)).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Exportacion a PDF (RF-18)
// ---------------------------------------------------------------------------

const ESPECIES: Record<string, string> = { perro: 'Perro', gato: 'Gato', otra: 'Otra' };
const SEXOS: Record<string, string> = { macho: 'Macho', hembra: 'Hembra', desconocido: 'Sin especificar' };

/** Genera el PDF del carnet, listo para imprimir o mandar por WhatsApp. */
export async function generarPdfCarnet(carnet: Carnet): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `Carnet de ${carnet.mascota.nombre}` } });
  const trozos: Buffer[] = [];
  doc.on('data', (t: Buffer) => trozos.push(t));
  const terminado = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  doc.fontSize(20).text('Carnet de vacunación', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(16).text(carnet.mascota.nombre);
  doc.moveDown(0.5);

  doc.fontSize(10);
  const ficha = [
    ['Especie', ESPECIES[carnet.mascota.especie] ?? carnet.mascota.especie],
    ['Raza', carnet.mascota.raza ?? '—'],
    ['Nacimiento', carnet.mascota.nacimiento ? fechaLargaDeFechaLocal(carnet.mascota.nacimiento) : '—'],
    ['Peso', carnet.mascota.pesoKg !== null ? `${carnet.mascota.pesoKg} kg` : '—'],
    ['Sexo', SEXOS[carnet.mascota.sexo] ?? carnet.mascota.sexo],
    ['Esterilizada', carnet.mascota.esterilizada === null ? '—' : carnet.mascota.esterilizada ? 'Sí' : 'No'],
    ['Responsable', carnet.duena.nombre ?? carnet.duena.celular],
  ];
  for (const [etiqueta, valor] of ficha) {
    doc.font('Helvetica-Bold').text(`${etiqueta}: `, { continued: true });
    doc.font('Helvetica').text(valor!);
  }

  if (carnet.mascota.notasManejo) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Notas de manejo: ', { continued: true });
    doc.font('Helvetica').text(carnet.mascota.notasManejo);
  }

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(13).text('Aplicaciones');
  doc.moveDown(0.4);
  doc.fontSize(9);

  if (carnet.aplicaciones.length === 0) {
    doc.font('Helvetica-Oblique').text('Todavía no hay aplicaciones registradas.');
  } else {
    for (const a of carnet.aplicaciones) {
      doc.font('Helvetica-Bold').text(a.producto, { continued: true });
      doc.font('Helvetica').text(`  ·  ${fechaLargaDeFechaLocal(a.fechaAplicacion)}`);

      const detalle: string[] = [];
      if (a.marca) detalle.push(`Marca: ${a.marca}`);
      if (a.lote) detalle.push(`Lote: ${a.lote}`);
      if (a.fechaRefuerzo) detalle.push(`Refuerzo: ${fechaLargaDeFechaLocal(a.fechaRefuerzo)}`);
      if (a.veterinario) detalle.push(`Veterinario: ${a.veterinario}`);
      if (a.cedulaProfesional) detalle.push(`Cédula: ${a.cedulaProfesional}`);
      if (detalle.length > 0) doc.font('Helvetica').fillColor('#444').text(detalle.join('  ·  '));
      doc.fillColor('black').moveDown(0.5);
    }
  }

  doc.moveDown(1);
  doc
    .fontSize(8)
    .fillColor('#666')
    .text(
      `Generado por Huella el ${carnet.generadoEn.toLocaleDateString('es-MX')}. ` +
        `Versión ${carnet.version}. Este documento reproduce lo registrado por la responsable; ` +
        `no sustituye al carnet sellado por un médico veterinario.`,
    );

  doc.end();
  await terminado;
  return Buffer.concat(trozos);
}
