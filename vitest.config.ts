import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres database, so they must not run
    // concurrently with each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['tests/setup.ts'],
    // Deja la base de pruebas al día antes de correr nada, y detiene la suite
    // con un mensaje claro si detecta cualquier desfase de migraciones.
    globalSetup: ['tests/global-setup.ts'],
  },
});
