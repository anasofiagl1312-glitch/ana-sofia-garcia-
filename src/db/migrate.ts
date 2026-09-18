/**
 * Corredor de migraciones.
 *
 * Aplica en orden los archivos de db/migrations, cada uno dentro de su propia
 * transaccion, y registra los aplicados en schema_migrations. Volver a correrlo
 * no hace nada.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

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

    const { rows } = await cliente.query<{ nombre: string }>('SELECT nombre FROM schema_migrations');
    const yaAplicadas = new Set(rows.map((r) => r.nombre));

    const archivos = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const archivo of archivos) {
      if (yaAplicadas.has(archivo)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, archivo), 'utf8');
      await cliente.query('BEGIN');
      try {
        await cliente.query(sql);
        await cliente.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [archivo]);
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
