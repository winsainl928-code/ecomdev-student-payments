import { fileURLToPath } from 'node:url';

// Демонстрационные записи хранятся отдельно от обычной базы приложения.
if (!process.env.DB_PATH) {
  process.env.DB_PATH = fileURLToPath(new URL('../data/preview.sqlite', import.meta.url));
}

await import('./seed.js');
await import('../src/server.js');
