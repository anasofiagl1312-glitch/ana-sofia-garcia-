/**
 * Corredor de migraciones.
 *
 * Aplica en orden los archivos de db/migrations, cada uno dentro de su propia
 * transaccion, y registra los aplicados en schema_migrations. Volver a correrlo
 * no hace nada.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

/** Los archivos .sql de db/migrations, en orden, con su huella. */
export async function migracionesEnDisco(): Promise<Array<{ nombre: string; sql: string; sha256: string }>> {
  const archivos = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    archivos.map(async (nombre) => {
      const sql = await readFile(join(MIGRATIONS_DIR, nombre), 'utf8');
      return { nombre, sql, sha256: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

export async function migrar(connectionString: string, opciones: { silencioso?: boolean } = {}): Promise<string[]> {
  const log = opciones.silencioso ? () => {} : (m: string) => console.log(m);
  const cliente = new pg.Client({ connectionString });
  await cliente.connect();
  const aplicadas: string[] = [];

  try {
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre      text PRIMARY KEY,
        aplicada_en timestamptz NOT NULL DEFAULT now()
      )
    `);
    // La huella del archivo permite detectar que alguien edito una migracion ya
    // aplicada, que es la forma silenciosa de que dos bases dejen de ser iguales.
    await cliente.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS sha256 text');

    const { rows } = await cliente.query<{ nombre: string }>('SELECT nombre FROM schema_migrations');
    const yaAplicadas = new Set(rows.map((r) => r.nombre));

    const enDisco = await migracionesEnDisco();

    for (const { nombre: archivo, sql, sha256 } of enDisco) {
      if (yaAplicadas.has(archivo)) {
        // Las que se aplicaron antes de que existiera la columna no tienen
        // huella. No se puede saber con que contenido corrieron, asi que se
        // adopta el de disco: de aqui en adelante si se detecta un cambio.
        await cliente.query(
          'UPDATE schema_migrations SET sha256 = $2 WHERE nombre = $1 AND sha256 IS NULL',
          [archivo, sha256],
        );
        continue;
      }
      await cliente.query('BEGIN');
      try {
        await cliente.query(sql);
        await cliente.query('INSERT INTO schema_migrations (nombre, sha256) VALUES ($1, $2)', [archivo, sha256]);
        await cliente.query('COMMIT');
        aplicadas.push(archivo);
        log(`  aplicada  ${archivo}`);
      } catch (error) {
        await cliente.query('ROLLBACK');
        throw new Error(`Fallo la migracion ${archivo}: ${(error as Error).message}`, { cause: error });
      }
    }

    if (aplicadas.length === 0) log('  sin migraciones pendientes');
    return aplicadas;
  } finally {
    await cliente.end();
  }
}

/** Borra por completo el esquema. Solo para la base de pruebas. */
export async function reiniciarEsquema(connectionString: string): Promise<void> {
  const cliente = new pg.Client({ connectionString });
  await cliente.connect();
  try {
    await cliente.query('DROP SCHEMA IF EXISTS public CASCADE');
    await cliente.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
    await cliente.query('CREATE SCHEMA public');
  } finally {
    await cliente.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { cargarConfig } = await import('../config/index.js');
  const config = cargarConfig();
  console.log(`Migrando ${config.databaseUrl.replace(/:[^:@/]*@/, ':***@')}`);
  await migrar(config.databaseUrl);
}


export interface EstadoDeMigraciones {
  /** Estan en disco y no en la base. */
  pendientes: string[];
  /** Estan en la base y ya no en disco: alguien borro o renombro un archivo. */
  desconocidas: string[];
  /** Se aplicaron con un contenido distinto del que hoy tiene el archivo. */
  modificadas: string[];
}

/**
 * Compara db/migrations contra lo que la base dice tener aplicado.
 *
 * Sirve para que el desfase entre la base de desarrollo y la de pruebas no
 * pueda pasar desapercibido: es una diferencia que no rompe nada hasta que
 * rompe algo raro, y entonces cuesta horas entender por que.
 */
export async function estadoDeMigraciones(connectionString: string): Promise<EstadoDeMigraciones> {
  const cliente = new pg.Client({ connectionString });
  await cliente.connect();
  try {
    const { rows: existe } = await cliente.query<{ hay: boolean }>(
      `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS hay`,
    );

    const enDisco = await migracionesEnDisco();
    if (!existe[0]?.hay) {
      return { pendientes: enDisco.map((m) => m.nombre), desconocidas: [], modificadas: [] };
    }

    const { rows } = await cliente.query<{ nombre: string; sha256: string | null }>(
      'SELECT nombre, sha256 FROM schema_migrations',
    );
    const aplicadas = new Map(rows.map((r) => [r.nombre, r.sha256]));

    return {
      pendientes: enDisco.filter((m) => !aplicadas.has(m.nombre)).map((m) => m.nombre),
      desconocidas: [...aplicadas.keys()].filter((n) => !enDisco.some((m) => m.nombre === n)),
      modificadas: enDisco
        .filter((m) => {
          const huella = aplicadas.get(m.nombre);
          return huella != null && huella !== m.sha256;
        })
        .map((m) => m.nombre),
    };
  } finally {
    await cliente.end();
  }
}
