/**
 * Proceso trabajador.
 *
 * Se ejecuta aparte del servidor HTTP para que una avalancha de peticiones no
 * retrase los recordatorios, que es lo unico que el producto no puede permitirse
 * (RNF-03). Pueden correr varias instancias: los barridos toman las filas con
 * bloqueo y SKIP LOCKED.
 */
import pino from 'pino';
import { cargarConfig } from '../config/index.js';
import { crearPool } from '../db/pool.js';
import { crearCanalWhatsApp } from '../channels/whatsapp/index.js';
import { crearCola, iniciarTrabajos } from './cola.js';

const config = cargarConfig();
const log = pino({ level: config.nivelLog });
const pool = crearPool(config.databaseUrl);
const whatsapp = crearCanalWhatsApp(config.whatsapp);
const boss = crearCola(config.databaseUrl);

boss.on('error', (error) => log.error({ error }, 'error de la cola'));

await boss.start();
await iniciarTrabajos(boss, {
  pool,
  whatsapp,
  registrar: (mensaje, datos) => log.info(datos ?? {}, mensaje),
});

log.info('trabajador listo');

async function apagar(senal: string): Promise<void> {
  log.info({ senal }, 'apagando trabajador');
  await boss.stop({ wait: true });
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void apagar('SIGTERM'));
process.on('SIGINT', () => void apagar('SIGINT'));
