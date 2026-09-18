import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AlmacenEnMemoria,
  AlmacenLocal,
  BYTES_MAXIMOS,
  DocumentoRechazado,
  LlaveDeCifradoInvalida,
  cifrar,
  descifrar,
  llaveDesdeBase64,
  validarDocumento,
} from '../../src/modules/almacenamiento/index.js';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LLAVE = randomBytes(32);

describe('cifrado en reposo (RNF-06)', () => {
  it('lo cifrado se descifra igual', () => {
    const original = Buffer.from('Carnet de Lola: rabia, lote A-4471');
    expect(descifrar(cifrar(original, LLAVE), LLAVE).toString()).toBe(original.toString());
  });

  it('el mismo contenido produce cifrados distintos', () => {
    const original = Buffer.from('mismo contenido');
    // Con IV aleatorio, dos cifrados del mismo archivo no se pueden comparar
    // para saber que son iguales.
    expect(cifrar(original, LLAVE).equals(cifrar(original, LLAVE))).toBe(false);
  });

  it('un archivo alterado no se descifra en silencio, falla', () => {
    const cifrado = cifrar(Buffer.from('contenido'), LLAVE);
    cifrado[cifrado.length - 1] ^= 0xff;
    expect(() => descifrar(cifrado, LLAVE)).toThrow();
  });

  it('con otra llave no se abre', () => {
    const cifrado = cifrar(Buffer.from('contenido'), LLAVE);
    expect(() => descifrar(cifrado, randomBytes(32))).toThrow();
  });

  it('un archivo truncado se rechaza con un mensaje claro', () => {
    expect(() => descifrar(Buffer.alloc(4), LLAVE)).toThrow(/truncado/i);
  });

  it('exige una llave de 32 bytes', () => {
    expect(() => llaveDesdeBase64(randomBytes(16).toString('base64'))).toThrow(LlaveDeCifradoInvalida);
    expect(llaveDesdeBase64(randomBytes(32).toString('base64'))).toHaveLength(32);
  });
});

describe('AlmacenLocal', () => {
  it('guarda cifrado en disco y devuelve el contenido en claro', async () => {
    const raiz = await mkdtemp(join(tmpdir(), 'huella-'));
    const almacen = new AlmacenLocal(raiz, LLAVE);
    const contenido = Buffer.from('carnet escaneado');

    const guardado = await almacen.guardar('ana/lola/doc1', contenido);
    expect(guardado.bytes).toBe(contenido.byteLength);

    // Lo que quedo en disco NO es el contenido.
    const enDisco = await readFile(join(raiz, 'ana/lola/doc1'));
    expect(enDisco.includes('carnet')).toBe(false);

    expect((await almacen.leer('ana/lola/doc1')).toString()).toBe('carnet escaneado');
    await almacen.borrar('ana/lola/doc1');
    await expect(almacen.leer('ana/lola/doc1')).rejects.toThrow();
  });

  it('no deja escribir fuera del directorio del almacen', async () => {
    const raiz = await mkdtemp(join(tmpdir(), 'huella-'));
    const almacen = new AlmacenLocal(raiz, LLAVE);
    await expect(almacen.guardar('../../fuera', Buffer.from('x'))).rejects.toThrow(/fuera del almacén/i);
  });

  it('el checksum es del contenido en claro, para detectar cargas repetidas', async () => {
    const almacen = new AlmacenEnMemoria(LLAVE);
    const a = await almacen.guardar('a', Buffer.from('mismo carnet'));
    const b = await almacen.guardar('b', Buffer.from('mismo carnet'));
    expect(a.sha256).toBe(b.sha256);
  });
});

describe('validarDocumento (RF-16)', () => {
  it('acepta fotos y PDF', () => {
    for (const tipo of ['image/jpeg', 'image/png', 'image/heic', 'application/pdf']) {
      expect(() => validarDocumento(tipo, 1024), tipo).not.toThrow();
    }
  });

  it('rechaza otros tipos, archivos vacios y archivos enormes', () => {
    expect(() => validarDocumento('application/zip', 1024)).toThrow(DocumentoRechazado);
    expect(() => validarDocumento('image/jpeg', 0)).toThrow(DocumentoRechazado);
    expect(() => validarDocumento('image/jpeg', BYTES_MAXIMOS + 1)).toThrow(DocumentoRechazado);
  });
});
