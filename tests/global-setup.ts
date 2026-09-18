/**
 * Arranque de la suite.
 *
 * Corre UNA vez antes de todas las pruebas y deja la base de pruebas al día.
 *
 * Existe por un problema concreto: las migraciones se aplicaban a la base de
 * desarrollo con `npm run migrate` y la de pruebas se quedaba atrás hasta que
 * alguien corría las pruebas de integración, que la migraban de paso y en
 * silencio. Dos bases con esquemas distintos y nadie enterado es la clase de
 * diferencia que no rompe nada hasta que rompe algo incomprensible.
 *
 * Ahora la suite migra de entrada y, si después de migrar sigue habiendo
 * cualquier discrepancia, se detiene con un mensaje que dice cuál.
 */
import { estadoDeMigraciones, migrar } from '../src/db/migrate.js';

const URL_PRUEBAS =
  process.env['DATABASE_URL_TEST'] ?? 'postgres://postgres:postgres@localhost:5432/huella_test';

export async function setup(): Promise<void> {
  const aplicadas = await migrar(URL_PRUEBAS, { silencioso: true });
  if (aplicadas.length > 0) {
    console.log(`\n  Base de pruebas al día: se aplicaron ${aplicadas.length} migración(es): ${aplicadas.join(', ')}\n`);
  }

  const estado = await estadoDeMigraciones(URL_PRUEBAS);
  const problemas: string[] = [];

  if (estado.pendientes.length > 0) {
    problemas.push(
      `Quedaron migraciones sin aplicar: ${estado.pendientes.join(', ')}.\n` +
        '    Es un fallo del propio migrador; revisa el error que dejó al correr.',
    );
  }
  if (estado.desconocidas.length > 0) {
    problemas.push(
      `La base tiene aplicadas migraciones que ya no están en db/migrations: ${estado.desconocidas.join(', ')}.\n` +
        '    Alguien borró o renombró un archivo ya aplicado. Las migraciones son solo hacia adelante.',
    );
  }
  if (estado.modificadas.length > 0) {
    problemas.push(
      `Estas migraciones se aplicaron con un contenido distinto al que hoy tiene el archivo: ` +
        `${estado.modificadas.join(', ')}.\n` +
        '    Editar una migración ya aplicada deja cada base en un estado distinto.\n' +
        '    Para cambiar el esquema se agrega un archivo nuevo.',
    );
  }

  if (problemas.length > 0) {
    throw new Error(
      `\n\n  La base de pruebas no está en el estado que el código espera:\n\n` +
        problemas.map((p) => `  · ${p}`).join('\n\n') +
        `\n\n  Base: ${URL_PRUEBAS.replace(/:[^:@/]*@/, ':***@')}\n`,
    );
  }
}
