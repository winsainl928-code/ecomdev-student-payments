import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT должен быть целым числом от 1 до 65535.');
  process.exit(1);
}
const app = createApp(process.env.DB_PATH ? { dbPath: process.env.DB_PATH } : {});
app.server.on('error', error => {
  console.error(`Не удалось запустить сервер: ${error.message}`);
  app.close().finally(() => { process.exitCode = 1; });
});
app.server.listen(port, '127.0.0.1', () => {
  console.log(`Учебный центр: http://127.0.0.1:${port}`);
  console.log('Только локальное использование. Остановка: Ctrl+C.');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => app.close().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }));
}
