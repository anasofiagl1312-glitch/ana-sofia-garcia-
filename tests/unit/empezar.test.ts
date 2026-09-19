/**
 * `npm run empezar`: encontrar (o no) el PostgreSQL de quien corre el proyecto.
 *
 * Lo que se prueba aquí es el caso que más duele y que no se puede provocar a
 * mano sin apagar la base: que cuando NINGUNA dirección contesta, la búsqueda
 * lo diga en vez de devolver una cualquiera y hacer que el script falle más
 * adelante con un error que habla de otra cosa.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — es un script de operación, no código de la app: no hay tipos.
import { buscarServidor, candidatas, sinBase, sinContrasena } from '../../scripts/postgres.mjs';

const MUERTAS = async () => false;
const VIVAS = async () => true;

describe('encontrar PostgreSQL', () => {
  it('si ninguna dirección contesta, devuelve null', async () => {
    expect(await buscarServidor(candidatas(undefined, 'ana'), MUERTAS)).toBeNull();
  });

  it('devuelve la primera que contesta, no la última', async () => {
    const vistas: string[] = [];
    const soloLaTercera = async (url: string) => {
      vistas.push(url);
      return vistas.length === 3;
    };

    const elegida = await buscarServidor(candidatas(undefined, 'ana'), soloLaTercera);

    expect(elegida).toBe(vistas[2]);
    expect(vistas).toHaveLength(3); // deja de probar en cuanto encuentra una
  });

  it('lo que diga .env se prueba primero', async () => {
    const mia = 'postgres://ana@localhost:5433/huella';
    expect(await buscarServidor(candidatas(mia, 'ana'), VIVAS)).toBe(sinBase(mia));
  });

  it('sin .env, prueba el usuario de la Mac antes que postgres:postgres', async () => {
    // Con Homebrew el rol se llama como tú y el rol "postgres" ni existe.
    const lista = candidatas(undefined, 'ana');
    expect(lista[0]).toContain('ana@localhost');
    expect(lista.findIndex((u: string) => u.includes('postgres:postgres')))
      .toBeGreaterThan(0);
  });

  it('siempre se conecta a la base "postgres", que es la que seguro existe', async () => {
    for (const url of candidatas('postgres://ana@localhost:5432/huella', 'ana')) {
      expect(url.endsWith('/postgres')).toBe(true);
    }
  });

  it('no imprime la contraseña', () => {
    expect(sinContrasena('postgres://postgres:secreta@localhost:5432/huella'))
      .toBe('postgres://postgres:···@localhost:5432/huella');
  });
});
