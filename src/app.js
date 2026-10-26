import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { HttpError, paymentInput, positiveId, studentInput } from './validation.js';

export const defaultDbPath = fileURLToPath(new URL('../data/school.sqlite', import.meta.url));
const publicDir = new URL('../public/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function parseBody(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    request.resume();
    throw new HttpError(415, 'Используйте Content-Type: application/json.');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 32 * 1024) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'Тело запроса превышает 32 КБ.'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Некорректный JSON.')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new HttpError(400, 'Передача запроса прервана.')));
  });
}

export function createApp({ dbPath = defaultDbPath } = {}) {
  const store = openStore(dbPath);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = new URL(`http://${request.headers.host || 'localhost'}`);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) {
        throw new HttpError(403, 'Учебное приложение доступно только через localhost.');
      }
      if (request.headers.origin && request.headers.origin !== host.origin) {
        throw new HttpError(403, 'Запрос с другого сайта запрещён.');
      }
      const url = new URL(request.url, host);
      const path = url.pathname;
      const method = request.method;
      if ((method === 'GET' || method === 'HEAD') && files.has(path)) {
        const [filename, contentType] = files.get(path);
        const bytes = await readFile(new URL(filename, publicDir));
        response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': bytes.length });
        response.end(method === 'HEAD' ? undefined : bytes);
        return;
      }
      if (method === 'GET' && path === '/health') return json(response, 200, { status: 'ok' });
      if (method === 'GET' && path === '/students') return json(response, 200, store.listStudents());
      if (method === 'POST' && path === '/students') {
        const student = store.createStudent(studentInput(await parseBody(request)));
        response.setHeader('Location', `/students/${student.id}`);
        return json(response, 201, student);
      }
      const studentMatch = /^\/students\/(\d+)$/.exec(path);
      if (studentMatch) {
        const id = positiveId(Number(studentMatch[1]));
        if (method === 'GET') return json(response, 200, store.getStudent(id));
        if (['PUT', 'PATCH'].includes(method)) {
          const input = studentInput(await parseBody(request), { partial: true });
          return json(response, 200, store.updateStudent(id, input));
        }
        if (method === 'DELETE') {
          store.deleteStudent(id);
          response.writeHead(204);
          response.end();
          return;
        }
      }
      const paymentsMatch = /^\/students\/(\d+)\/payments$/.exec(path);
      if (method === 'GET' && paymentsMatch) {
        return json(response, 200, store.listPayments(positiveId(Number(paymentsMatch[1]))));
      }
      if (method === 'POST' && path === '/payments') {
        return json(response, 201, store.createPayment(paymentInput(await parseBody(request))));
      }
      if (method === 'GET' && path === '/debtors') {
        return json(response, 200, store.debtors(url.searchParams.get('month')));
      }
      throw new HttpError(404, 'Маршрут не найден.');
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      if (!(error instanceof HttpError)) console.error('Ошибка приложения:', error.message);
      json(response, error instanceof HttpError ? error.status : 500,
        { error: error instanceof HttpError ? error.message : 'Внутренняя ошибка сервера.' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  let closed = false;
  return {
    server,
    async close() {
      if (closed) return;
      closed = true;
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      store.close();
    },
  };
}
