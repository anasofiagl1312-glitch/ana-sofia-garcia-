/*
 * Encontrar el PostgreSQL de quien corre el proyecto.
 *
 * Vive aparte de empezar.mjs para poder probarlo: lo que importa es que
 * cuando NO hay ninguna base a la que conectarse, esto lo diga en vez de
 * seguir adelante y fallar más tarde con un error de otra cosa.
 */
import { userInfo } from 'node:os';
import pg from 'pg';

/** Prueba una conexión y dice si sirvió, sin tirar a quien la llama. */
export async function conecta(url, msTiempoLimite = 4000) {
  const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: msTiempoLimite });
  try {
    await cliente.connect();
    await cliente.query('SELECT 1');
    await cliente.end();
    return true;
  } catch {
    try { await cliente.end(); } catch { /* ya estaba cerrado */ }
    return false;
  }
}

/** La misma dirección, pero apuntando a la base `postgres`, que siempre existe. */
export function sinBase(url) {
  return url.replace(/\/[^/?]*(\?.*)?$/, '/postgres');
}

/**
 * En orden de probabilidad, no de preferencia.
 *
 * Lo que dice .env va primero porque si alguien ya lo configuró, manda. Luego
 * el usuario de la Mac sin contraseña, que es como queda PostgreSQL instalado
 * con Homebrew (el rol se llama como tú, y el rol "postgres" ni existe). Al
 * final postgres:postgres, que es lo que trae .env.example y lo que usan los
 * contenedores.
 */
export function candidatas(urlDelEnv, usuario = userInfo().username) {
  return [
    urlDelEnv,
    `postgres://${usuario}@localhost:5432/postgres`,
    'postgres://postgres:postgres@localhost:5432/postgres',
    'postgres://postgres@localhost:5432/postgres',
  ].filter(Boolean).map(sinBase);
}

/** La primera que conteste, o `null` si ninguna. */
export async function buscarServidor(urls, probar = conecta) {
  for (const url of urls) {
    if (await probar(url)) return url;
  }
  return null;
}

/** Esconde la contraseña para poder imprimir la dirección. */
export function sinContrasena(url) {
  return url.replace(/:[^:@/]*@/, ':···@');
}
