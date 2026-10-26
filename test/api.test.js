import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

async function startApi(t, dbPath = ':memory:') {
  const app = createApp({ dbPath });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  if (t) t.after(() => app.close());
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  return {
    ...app,
    baseUrl,
    async request(url, { method = 'GET', body } = {}) {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
  };
}

function student(overrides = {}) {
  return {
    name: 'Алия Тестовая',
    phone: '+998901234567',
    group: 'Английский A2',
    monthlyFee: '100.00',
    ...overrides,
  };
}

async function addStudent(api, overrides = {}) {
  const result = await api.request('/students', { method: 'POST', body: student(overrides) });
  assert.equal(result.status, 201);
  return result.body;
}

async function addPayment(api, studentId, amount, date = '2026-10-15') {
  const result = await api.request('/payments', {
    method: 'POST',
    body: { studentId, amount, date },
  });
  assert.equal(result.status, 201);
  return result.body;
}

test('student CRUD returns saved data and supports partial updates', async (t) => {
  const api = await startApi(t);
  const created = await addStudent(api, { monthlyFee: 99.5 });
  assert.ok(Number.isSafeInteger(created.id));
  assert.equal(created.monthlyFee, '99.50');
  const list = await api.request('/students');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, [created]);
  assert.deepEqual((await api.request(`/students/${created.id}`)).body, created);

  const patched = await api.request(`/students/${created.id}`, {
    method: 'PATCH', body: { group: 'Английский B1' },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.group, 'Английский B1');
  assert.equal(patched.body.name, created.name);
  assert.equal(patched.body.monthlyFee, '99.50');

  const updated = await api.request(`/students/${created.id}`, {
    method: 'PUT', body: { name: 'Алия Обновлённая', monthlyFee: '125.25' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Алия Обновлённая');
  assert.equal(updated.body.monthlyFee, '125.25');
  assert.equal(updated.body.group, 'Английский B1');
});

test('deleting a student also removes their payments and debt', async (t) => {
  const api = await startApi(t);
  const saved = await addStudent(api);
  await addPayment(api, saved.id, '20.00');
  const deleted = await api.request(`/students/${saved.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  assert.equal(deleted.body, null);
  assert.deepEqual((await api.request('/students')).body, []);
  assert.equal((await api.request(`/students/${saved.id}/payments`)).status, 404);
  const debtors = await api.request('/debtors?month=2026-10');
  assert.deepEqual(debtors.body.debtors, []);
  assert.equal(debtors.body.totalDebt, '0.00');
});

test('payments are listed for the requested student only', async (t) => {
  const api = await startApi(t);
  const first = await addStudent(api);
  const second = await addStudent(api, { name: 'Тимур Тестовый' });
  const payment = await addPayment(api, first.id, '35.50', '2026-10-02');
  await addPayment(api, second.id, '77.00', '2026-10-03');
  assert.equal(payment.studentId, first.id);
  assert.equal(payment.amount, '35.50');
  assert.equal(payment.date, '2026-10-02');
  assert.ok(Number.isSafeInteger(payment.id));
  const result = await api.request(`/students/${first.id}/payments`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [payment]);
});

test('debtors include partial and missing payments but exclude full, excess and zero fees', async (t) => {
  const api = await startApi(t);
  const partial = await addStudent(api, { name: 'Частичная оплата' });
  const full = await addStudent(api, { name: 'Полная оплата' });
  const overpaid = await addStudent(api, { name: 'Переплата' });
  await addStudent(api, { name: 'Бесплатная группа', monthlyFee: '0.00' });
  const unpaid = await addStudent(api, { name: 'Нет оплат', monthlyFee: '40.00' });
  await addPayment(api, partial.id, '30.00');
  await addPayment(api, partial.id, '20.00');
  await addPayment(api, full.id, '100.00');
  await addPayment(api, overpaid.id, '120.00');
  const result = await api.request('/debtors?month=2026-10');
  assert.equal(result.status, 200);
  assert.equal(result.body.month, '2026-10');
  assert.equal(result.body.totalDebt, '90.00');
  assert.equal(result.body.debtors.length, 2);
  const byId = new Map(result.body.debtors.map((row) => [row.studentId, row]));
  assert.equal(byId.get(partial.id).monthlyFee, '100.00');
  assert.equal(byId.get(partial.id).paid, '50.00');
  assert.equal(byId.get(partial.id).debt, '50.00');
  assert.equal(byId.get(unpaid.id).paid, '0.00');
  assert.equal(byId.get(unpaid.id).debt, '40.00');
});

test('calendar month boundaries and year transitions do not carry payments over', async (t) => {
  const api = await startApi(t);
  const saved = await addStudent(api);
  await addPayment(api, saved.id, '100.00', '2025-12-31');
  await addPayment(api, saved.id, '20.00', '2026-01-01');
  await addPayment(api, saved.id, '30.00', '2026-01-31');
  await addPayment(api, saved.id, '40.00', '2026-02-01');
  const january = await api.request('/debtors?month=2026-01');
  assert.equal(january.body.debtors[0].paid, '50.00');
  assert.equal(january.body.debtors[0].debt, '50.00');
  const february = await api.request('/debtors?month=2026-02');
  assert.equal(february.body.debtors[0].paid, '40.00');
  assert.equal(february.body.debtors[0].debt, '60.00');
  assert.deepEqual((await api.request('/debtors?month=2025-12')).body.debtors, []);
});

test('leap-day payments are valid and belong to February', async (t) => {
  const api = await startApi(t);
  const saved = await addStudent(api);
  await addPayment(api, saved.id, '25.00', '2024-02-29');
  await addPayment(api, saved.id, '60.00', '2024-03-01');
  const february = await api.request('/debtors?month=2024-02');
  assert.equal(february.body.debtors[0].paid, '25.00');
  assert.equal(february.body.debtors[0].debt, '75.00');
});

test('money uses exact minor units: 0.10 plus 0.20 fully pays 0.30', async (t) => {
  const api = await startApi(t);
  const saved = await addStudent(api, { monthlyFee: 0.3 });
  assert.equal(saved.monthlyFee, '0.30');
  assert.equal((await addPayment(api, saved.id, 0.1)).amount, '0.10');
  assert.equal((await addPayment(api, saved.id, '0.20')).amount, '0.20');
  const result = await api.request('/debtors?month=2026-10');
  assert.deepEqual(result.body.debtors, []);
  assert.equal(result.body.totalDebt, '0.00');
});

test('invalid monetary values are rejected without saving payments or students', async (t) => {
  const api = await startApi(t);
  for (const monthlyFee of [-1, '1.001', 'Infinity', null, true, '1000000000.00']) {
    const result = await api.request('/students', {
      method: 'POST', body: student({ monthlyFee }),
    });
    assert.equal(result.status, 400, `monthlyFee ${JSON.stringify(monthlyFee)}`);
    assert.equal(typeof result.body.error, 'string');
  }
  assert.deepEqual((await api.request('/students')).body, []);
  const saved = await addStudent(api);
  for (const amount of ['0.00', '-0.01', '1.234', 'Infinity', null, true, '1000000000.00']) {
    const result = await api.request('/payments', {
      method: 'POST', body: { studentId: saved.id, amount, date: '2026-10-15' },
    });
    assert.equal(result.status, 400, `amount ${JSON.stringify(amount)}`);
  }
  assert.deepEqual((await api.request(`/students/${saved.id}/payments`)).body, []);
});

test('months and dates must be real calendar values in the specified format', async (t) => {
  const api = await startApi(t);
  for (const query of ['', '?month=2026-13', '?month=2026-00', '?month=2026-1', '?month=2026-02-01', '?month=wrong']) {
    const result = await api.request(`/debtors${query}`);
    assert.equal(result.status, 400, `query ${query}`);
    assert.equal(typeof result.body.error, 'string');
  }
  const saved = await addStudent(api);
  for (const date of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-1-01', '2026-10-01T12:00:00Z', '', null]) {
    const result = await api.request('/payments', {
      method: 'POST', body: { studentId: saved.id, amount: '10.00', date },
    });
    assert.equal(result.status, 400, `date ${JSON.stringify(date)}`);
  }
  assert.deepEqual((await api.request(`/students/${saved.id}/payments`)).body, []);
});

test('unknown students return 404 for reads, updates, deletion and payments', async (t) => {
  const api = await startApi(t);
  const cases = [
    ['/students/999', {}],
    ['/students/999', { method: 'PATCH', body: { name: 'Нет ученика' } }],
    ['/students/999', { method: 'DELETE' }],
    ['/students/999/payments', {}],
    ['/payments', { method: 'POST', body: { studentId: 999, amount: '10.00', date: '2026-10-15' } }],
  ];
  for (const [url, options] of cases) {
    const result = await api.request(url, options);
    assert.equal(result.status, 404, `${options.method ?? 'GET'} ${url}`);
    assert.equal(typeof result.body.error, 'string');
  }
});

test('malformed JSON and unsupported content types are rejected', async (t) => {
  const api = await startApi(t);
  const malformed = await fetch(`${api.baseUrl}/students`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, 'string');
  const plain = await fetch(`${api.baseUrl}/students`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(student()),
  });
  assert.equal(plain.status, 415);
  assert.deepEqual((await api.request('/students')).body, []);
});

test('required student fields are validated and failed edits leave the record intact', async (t) => {
  const api = await startApi(t);
  for (const body of [{}, student({ name: '' }), student({ group: '   ' }), student({ phone: '' }), []]) {
    assert.equal((await api.request('/students', { method: 'POST', body })).status, 400);
  }
  const saved = await addStudent(api);
  const invalid = await api.request(`/students/${saved.id}`, {
    method: 'PATCH', body: { name: 'Изменённое имя', monthlyFee: '-20.00' },
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await api.request(`/students/${saved.id}`)).body, saved);
});

test('quoted and HTML-like names remain literal data and do not change SQL', async (t) => {
  const api = await startApi(t);
  const name = `О'Коннор <img src=x onerror=alert(1)>`;
  const saved = await addStudent(api, { name });
  await addStudent(api, { name: "Robert'); DROP TABLE students;--" });
  assert.equal((await api.request(`/students/${saved.id}`)).body.name, name);
  assert.equal((await api.request('/students')).body.length, 2);
  const result = await api.request('/debtors?month=2026-10');
  assert.equal(result.status, 200);
  assert.equal(result.body.totalDebt, '200.00');
});

test('SQLite keeps students and payments after the application restarts', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ecomdev-api-test-'));
  const dbPath = path.join(directory, 'test.sqlite');
  let first;
  let second;
  t.after(async () => {
    if (second) await second.close();
    if (first) await first.close();
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), path.resolve(tmpdir()));
    assert.ok(path.basename(absolute).startsWith('ecomdev-api-test-'));
    await rm(absolute, { recursive: true, force: true });
  });
  first = await startApi(null, dbPath);
  const saved = await addStudent(first, { monthlyFee: '80.00' });
  const payment = await addPayment(first, saved.id, '30.00');
  await first.close();
  first = null;
  second = await startApi(null, dbPath);
  assert.deepEqual((await second.request('/students')).body, [saved]);
  assert.deepEqual((await second.request(`/students/${saved.id}/payments`)).body, [payment]);
  const result = await second.request('/debtors?month=2026-10');
  assert.equal(result.body.debtors[0].debt, '50.00');
});
