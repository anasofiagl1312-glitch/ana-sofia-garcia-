import pg from 'pg';

/**
 * `numeric` de Postgres llega como string al driver para no perder precision.
 * En este dominio los numeric son montos en pesos y pesos de mascota, que caben
 * de sobra en un double, y tratarlos como numero simplifica todo lo de arriba.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (valor) => Number(valor));
/** `date` sin hora: se queda como 'YYYY-MM-DD' en vez de volverse un Date en la
 *  zona del servidor, que es justo el error que RNF-02 quiere evitar. */
pg.types.setTypeParser(pg.types.builtins.DATE, (valor) => valor);
/** bigint de count(*) cabe en un number para los volumenes de RNF-08. */
pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => Number(valor));

export type Ejecutor = Pick<pg.Pool, 'query'>;

export function crearPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/** Corre `fn` dentro de una transaccion y hace rollback si lanza. */
export async function enTransaccion<T>(pool: pg.Pool, fn: (cliente: pg.PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}
