/**
 * Leer el carnet de una mascota y proponer lo que dice.
 *
 * El flujo tiene dos pasos a propósito:
 *
 *   1. `leerCarnet` lee el documento y devuelve una PROPUESTA. No escribe nada
 *      en mascota, aplicacion ni proveedor.
 *   2. `confirmarCarnet` guarda lo que la clienta aprobó, ya corregido por ella.
 *
 * Separarlos no es ceremonia. El carnet se lee de una foto de una libreta
 * escrita a mano, y una fecha mal leída no se nota: se convierte en un refuerzo
 * programado para el año equivocado y en un aviso que sale tarde, que es lo
 * único que el producto promete que no pasa (RNF-03). Una persona mirando la
 * pantalla atrapa eso en dos segundos; ninguna validación automática lo hace.
 *
 * Por eso también se guarda lo que ella confirmó, no lo que se leyó.
 */
import type pg from 'pg';
import type { Almacen } from '../almacenamiento/index.js';
import type { LectorDeCarnet } from '../../channels/carnet/index.js';
import { CarnetIlegible, sePuedeLeer } from '../../channels/carnet/index.js';
import { type PropuestaDeCarnet, normalizarLectura } from '../../domain/carnet.js';

/** La propuesta se guarda al lado del documento, por el mismo almacén cifrado. */
const SUFIJO_DE_LECTURA = '.lectura.json';

export interface ResumenDeLectura {
  documentoId: string;
  propuesta: PropuestaDeCarnet;
  /** `true` cuando se devolvió lo guardado en vez de volver a leer y volver a pagar. */
  deLaMemoria: boolean;
}

interface FilaDocumento {
  id: string;
  mascota_id: string | null;
  ruta_archivo: string;
  tipo_mime: string;
  leido_en: Date | null;
}

export class DocumentoNoEncontrado extends Error {}

/**
 * Lee el carnet y devuelve lo que propone guardar.
 *
 * Si ya se había leído, devuelve lo de antes en vez de volver a pagar. La
 * clienta que recarga la pantalla no debería costar el doble.
 */
export async function leerCarnet(
  pool: pg.Pool,
  opciones: {
    documentoId: string;
    usuariaId: string;
    almacen: Almacen;
    lector: LectorDeCarnet;
    /** Para volver a leer aunque ya hubiera lectura: la foto se cambió o salió mal. */
    forzar?: boolean;
    hoy?: Date;
  },
): Promise<ResumenDeLectura> {
  const { rows } = await pool.query<FilaDocumento>(
    `SELECT id, mascota_id, ruta_archivo, tipo_mime, leido_en
       FROM documento
      WHERE id = $1 AND usuaria_id = $2`,
    [opciones.documentoId, opciones.usuariaId],
  );
  const documento = rows[0];
  if (!documento) throw new DocumentoNoEncontrado('No se encontró ese documento.');

  if (documento.leido_en && !opciones.forzar) {
    const guardada = await leerPropuestaGuardada(opciones.almacen, documento.ruta_archivo);
    if (guardada) return { documentoId: documento.id, propuesta: guardada, deLaMemoria: true };
  }

  if (!opciones.lector.disponible) {
    throw new CarnetIlegible(
      'Ahorita no puedo leer el carnet solo. Captura las vacunas a mano; la foto ya quedó guardada.',
    );
  }
  if (!sePuedeLeer(documento.tipo_mime)) {
    throw new CarnetIlegible(
      'Ese formato no lo puedo leer, pero ya quedó guardado. Captura las vacunas a mano, o vuelve a subirlo como foto.',
    );
  }

  const contenido = await opciones.almacen.leer(documento.ruta_archivo);
  const { lectura, procedencia } = await opciones.lector.leer({
    contenido,
    tipoMime: documento.tipo_mime,
  });

  const propuesta = normalizarLectura(lectura, opciones.hoy ? { hoy: opciones.hoy } : {});

  await opciones.almacen.guardar(
    documento.ruta_archivo + SUFIJO_DE_LECTURA,
    Buffer.from(JSON.stringify(propuesta), 'utf8'),
  );

  await pool.query(
    `UPDATE documento
        SET leido_en = now(), lector = $2, lector_modelo = $3,
            lector_tokens = $4, lector_ms = $5, lectura_datos = $6
      WHERE id = $1`,
    [
      documento.id,
      procedencia.lector,
      procedencia.modelo,
      (procedencia.tokensEntrada ?? 0) + (procedencia.tokensSalida ?? 0) || null,
      procedencia.ms,
      propuesta.cuantosDatos,
    ],
  );

  return { documentoId: documento.id, propuesta, deLaMemoria: false };
}

async function leerPropuestaGuardada(almacen: Almacen, ruta: string): Promise<PropuestaDeCarnet | null> {
  try {
    const crudo = await almacen.leer(ruta + SUFIJO_DE_LECTURA);
    return JSON.parse(crudo.toString('utf8')) as PropuestaDeCarnet;
  } catch {
    // El documento dice que se leyó pero el archivo no está o no se descifra.
    // Volver a leer es más barato que dejar a la clienta sin su propuesta.
    return null;
  }
}

export interface CarnetConfirmado {
  mascota?: {
    nombre?: string | null;
    especie?: 'perro' | 'gato' | 'otra' | null;
    raza?: string | null;
    sexo?: 'macho' | 'hembra' | 'desconocido' | null;
    nacimiento?: string | null;
    nacimientoPrecision?: 'dia' | 'mes' | 'anio' | null;
    pesoKg?: number | null;
    esterilizada?: boolean | null;
  };
  aplicaciones?: Array<{
    producto: string;
    marca?: string | null;
    lote?: string | null;
    fechaAplicacion: string;
    fechaRefuerzo?: string | null;
    veterinario?: string | null;
    cedulaProfesional?: string | null;
  }>;
}

export interface ResultadoConfirmacion {
  mascotaActualizada: boolean;
  aplicacionesGuardadas: number;
  aplicacionesRepetidas: number;
}

/**
 * Guarda lo que la clienta aprobó.
 *
 * Todo en una transacción: si una aplicación falla, no se queda la mascota
 * actualizada a medias con un carnet a medio capturar.
 */
export async function confirmarCarnet(
  pool: pg.Pool,
  opciones: {
    mascotaId: string;
    usuariaId: string;
    documentoId?: string | null;
    confirmado: CarnetConfirmado;
  },
): Promise<ResultadoConfirmacion> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const { rowCount } = await cliente.query(
      `SELECT 1 FROM mascota WHERE id = $1 AND usuaria_id = $2 AND archivada_en IS NULL`,
      [opciones.mascotaId, opciones.usuariaId],
    );
    if (rowCount === 0) throw new DocumentoNoEncontrado('No se encontró la mascota.');

    const m = opciones.confirmado.mascota;
    let mascotaActualizada = false;

    if (m && Object.values(m).some((v) => v !== undefined)) {
      // COALESCE: lo que no venga en la confirmación no se toca. Si la clienta
      // borró un campo que el lector había propuesto, no llega en el cuerpo y
      // se queda como estaba, que es lo que ella espera.
      await cliente.query(
        `UPDATE mascota
            SET nombre = COALESCE($2, nombre),
                especie = COALESCE($3::especie, especie),
                raza = COALESCE($4, raza),
                sexo = COALESCE($5::sexo_mascota, sexo),
                nacimiento = COALESCE($6::date, nacimiento),
                nacimiento_precision = COALESCE($7, nacimiento_precision),
                peso_kg = COALESCE($8, peso_kg),
                esterilizada = COALESCE($9, esterilizada),
                actualizada_en = now()
          WHERE id = $1`,
        [
          opciones.mascotaId,
          m.nombre ?? null,
          m.especie ?? null,
          m.raza ?? null,
          m.sexo ?? null,
          m.nacimiento ?? null,
          m.nacimientoPrecision ?? null,
          m.pesoKg ?? null,
          m.esterilizada ?? null,
        ],
      );
      mascotaActualizada = true;
    }

    let guardadas = 0;
    let repetidas = 0;

    for (const a of opciones.confirmado.aplicaciones ?? []) {
      // Subir el carnet dos veces es normal: se toma otra foto porque salió
      // movida. Lo que no es normal es acabar con la vacuna dos veces y dos
      // avisos de refuerzo para la misma dosis.
      const { rowCount: yaEstaba } = await cliente.query(
        `SELECT 1 FROM aplicacion
          WHERE mascota_id = $1 AND fecha_aplicacion = $2::date AND lower(producto) = lower($3)`,
        [opciones.mascotaId, a.fechaAplicacion, a.producto],
      );
      if (yaEstaba && yaEstaba > 0) {
        repetidas += 1;
        continue;
      }

      await cliente.query(
        `INSERT INTO aplicacion (mascota_id, documento_id, producto, marca, lote,
                                 fecha_aplicacion, fecha_refuerzo, veterinario, cedula_profesional)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9)`,
        [
          opciones.mascotaId,
          opciones.documentoId ?? null,
          a.producto,
          a.marca ?? null,
          a.lote ?? null,
          a.fechaAplicacion,
          a.fechaRefuerzo ?? null,
          a.veterinario ?? null,
          a.cedulaProfesional ?? null,
        ],
      );
      guardadas += 1;
    }

    await cliente.query('COMMIT');
    return { mascotaActualizada, aplicacionesGuardadas: guardadas, aplicacionesRepetidas: repetidas };
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}
