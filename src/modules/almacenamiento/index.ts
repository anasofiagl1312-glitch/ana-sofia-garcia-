/**
 * Almacenamiento de documentos: carnets, recetas, estudios, comprobantes.
 *
 * RNF-06: "Datos personales y documentos cifrados en transito y en reposo."
 *
 * El cifrado se hace en la aplicacion, antes de escribir, y no se delega al
 * disco ni al bucket. La razon es concreta: el carnet de vacunacion trae nombre
 * de la usuaria, direccion de su veterinaria y la cedula profesional de un
 * medico. Con cifrado de la aplicacion, una copia del bucket o un respaldo
 * extraviado no sirve de nada sin la llave, que vive en otro lado.
 *
 * AES-256-GCM: cifra y autentica a la vez, asi que un archivo alterado no se
 * descifra en silencio, falla.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface ArchivoGuardado {
  ruta: string;
  bytes: number;
  sha256: string;
}

export interface Almacen {
  guardar(ruta: string, contenido: Buffer): Promise<ArchivoGuardado>;
  leer(ruta: string): Promise<Buffer>;
  borrar(ruta: string): Promise<void>;
}

const LARGO_IV = 12;
const LARGO_TAG = 16;

export class LlaveDeCifradoInvalida extends Error {}

export function llaveDesdeBase64(valor: string): Buffer {
  const llave = Buffer.from(valor, 'base64');
  if (llave.length !== 32) {
    throw new LlaveDeCifradoInvalida('ENCRYPTION_KEY debe ser de 32 bytes en base64 (openssl rand -base64 32).');
  }
  return llave;
}

export function cifrar(contenido: Buffer, llave: Buffer): Buffer {
  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv('aes-256-gcm', llave, iv);
  const cuerpo = Buffer.concat([cipher.update(contenido), cipher.final()]);
  // [iv][tag][cuerpo] en un solo archivo, para no tener que guardar metadatos
  // aparte que se puedan perder.
  return Buffer.concat([iv, cipher.getAuthTag(), cuerpo]);
}

export function descifrar(cifrado: Buffer, llave: Buffer): Buffer {
  if (cifrado.length < LARGO_IV + LARGO_TAG) {
    throw new Error('El archivo cifrado está truncado.');
  }
  const iv = cifrado.subarray(0, LARGO_IV);
  const tag = cifrado.subarray(LARGO_IV, LARGO_IV + LARGO_TAG);
  const cuerpo = cifrado.subarray(LARGO_IV + LARGO_TAG);
  const decipher = createDecipheriv('aes-256-gcm', llave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cuerpo), decipher.final()]);
}

/**
 * Almacen en disco local. Sirve para desarrollo y para un despliegue chico con
 * volumen persistente; para produccion se escribe el equivalente contra S3 o
 * Cloud Storage manteniendo esta misma interfaz y el mismo cifrado.
 */
export class AlmacenLocal implements Almacen {
  private readonly raiz: string;

  constructor(
    raiz: string,
    private readonly llave: Buffer,
  ) {
    this.raiz = resolve(raiz);
  }

  private rutaAbsoluta(ruta: string): string {
    const destino = resolve(join(this.raiz, ruta));
    // Una ruta con ".." no debe poder salirse del directorio de almacenamiento.
    if (destino !== this.raiz && !destino.startsWith(this.raiz + '/')) {
      throw new Error(`Ruta de archivo fuera del almacén: ${ruta}`);
    }
    return destino;
  }

  async guardar(ruta: string, contenido: Buffer): Promise<ArchivoGuardado> {
    const destino = this.rutaAbsoluta(ruta);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, cifrar(contenido, this.llave), { mode: 0o600 });
    return {
      ruta,
      bytes: contenido.byteLength,
      // El checksum es del contenido en claro: sirve para detectar que la
      // usuaria subio dos veces el mismo carnet, y el cifrado con IV aleatorio
      // daria un hash distinto cada vez.
      sha256: createHash('sha256').update(contenido).digest('hex'),
    };
  }

  async leer(ruta: string): Promise<Buffer> {
    return descifrar(await readFile(this.rutaAbsoluta(ruta)), this.llave);
  }

  async borrar(ruta: string): Promise<void> {
    await rm(this.rutaAbsoluta(ruta), { force: true });
  }
}

/** Almacen en memoria, para pruebas. Cifra igual, para probar el mismo camino. */
export class AlmacenEnMemoria implements Almacen {
  private readonly archivos = new Map<string, Buffer>();

  constructor(private readonly llave: Buffer) {}

  async guardar(ruta: string, contenido: Buffer): Promise<ArchivoGuardado> {
    this.archivos.set(ruta, cifrar(contenido, this.llave));
    return {
      ruta,
      bytes: contenido.byteLength,
      sha256: createHash('sha256').update(contenido).digest('hex'),
    };
  }

  async leer(ruta: string): Promise<Buffer> {
    const cifrado = this.archivos.get(ruta);
    if (!cifrado) throw new Error(`No existe el archivo ${ruta}`);
    return descifrar(cifrado, this.llave);
  }

  async borrar(ruta: string): Promise<void> {
    this.archivos.delete(ruta);
  }

  get cuantos(): number {
    return this.archivos.size;
  }
}

/** Tipos que se aceptan al cargar un documento (RF-16). */
export const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'] as const;
export const BYTES_MAXIMOS = 15 * 1024 * 1024;

export class DocumentoRechazado extends Error {}

export function validarDocumento(tipoMime: string, bytes: number): void {
  if (!TIPOS_PERMITIDOS.includes(tipoMime as (typeof TIPOS_PERMITIDOS)[number])) {
    throw new DocumentoRechazado(`Tipo de archivo no admitido: ${tipoMime}. Se aceptan fotos y PDF.`);
  }
  if (bytes > BYTES_MAXIMOS) {
    throw new DocumentoRechazado(`El archivo pesa demasiado (máximo ${BYTES_MAXIMOS / 1024 / 1024} MB).`);
  }
  if (bytes === 0) throw new DocumentoRechazado('El archivo llegó vacío.');
}
