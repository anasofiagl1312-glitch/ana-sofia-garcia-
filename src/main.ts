/**
 * Punto de entrada del servidor HTTP.
 *
 * Los barridos NO corren aqui: viven en src/jobs/worker-main.ts, en su propio
 * proceso. Es deliberado -- una avalancha de peticiones no debe retrasar un
 * recordatorio (RNF-03), y el trabajador debe poder escalarse aparte.
 */
import { cargarConfig } from './config/index.js';
import { crearPool } from './db/pool.js';
import { crearCanalWhatsApp } from './channels/whatsapp/index.js';
import { crearLectorDeCarnet } from './channels/carnet/index.js';
import { AlmacenLocal, llaveDesdeBase64 } from './modules/almacenamiento/index.js';
import { PasarelaFalsa } from './modules/suscripcion/servicio.js';
import { crearServidor } from './http/servidor.js';

const config = cargarConfig();
const pool = crearPool(config.databaseUrl);

if (!config.llaveCifrado) {
  throw new Error('Falta ENCRYPTION_KEY: los documentos se guardan cifrados (RNF-06).');
}

const app = await crearServidor({
  pool,
  config,
  whatsapp: crearCanalWhatsApp(config.whatsapp),
  almacen: new AlmacenLocal(config.almacenamiento.rutaLocal, llaveDesdeBase64(config.llaveCifrado)),
  // La pasarela real se conecta aqui cuando se elija (ver docs/respuesta-tecnica.md).
  pasarela: new PasarelaFalsa(),
  lectorDeCarnet: await crearLectorDeCarnet(config.carnet),
});

await app.listen({ port: config.puerto, host: '0.0.0.0' });

for (const senal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(senal, () => {
    void (async () => {
      await app.close();
      await pool.end();
      process.exit(0);
    })();
  });
}
