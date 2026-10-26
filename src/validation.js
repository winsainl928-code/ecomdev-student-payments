export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Тело запроса должно быть JSON-объектом.');
  }
}

export function textField(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${label}: укажите непустую строку до ${maxLength} символов.`);
  }
  return value.trim();
}

// Все вычисления выполняются в целых сотых долях, без арифметики float.
export function moneyToMinor(value, { positive = false } = {}) {
  if (!['string', 'number'].includes(typeof value)) {
    throw new HttpError(400, 'Сумма должна быть числом или десятичной строкой.');
  }
  const raw = String(value).trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw)) {
    throw new HttpError(400, 'Сумма: от 0 до 999999999.99, не более двух знаков после точки.');
  }
  const [whole, fraction = ''] = raw.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (positive && minor === 0) {
    throw new HttpError(400, 'Сумма оплаты должна быть больше нуля.');
  }
  return minor;
}

export function moneyFromMinor(minor) {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error('Сумма вне безопасного целочисленного диапазона.');
  }
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'Дата оплаты должна иметь формат YYYY-MM-DD.');
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new HttpError(400, 'Укажите существующую календарную дату.');
  }
  return value;
}

export function monthRange(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'Укажите месяц в формате YYYY-MM.');
  }
  const [year, month] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) {
    throw new HttpError(400, 'Укажите существующий месяц.');
  }
  return { start: `${value}-01`, end: `${value}-${daysInMonth(year, month)}` };
}

export function positiveId(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HttpError(400, 'ID ученика должен быть положительным целым числом.');
  }
  return value;
}

export function studentInput(body, { partial = false } = {}) {
  requireObject(body);
  const allowed = ['name', 'phone', 'group', 'monthlyFee'];
  if (Object.keys(body).some(key => !allowed.includes(key))) {
    throw new HttpError(400, 'Допустимы только name, phone, group и monthlyFee.');
  }
  if (partial && Object.keys(body).length === 0) {
    throw new HttpError(400, 'Передайте хотя бы одно поле для изменения.');
  }
  const result = {};
  for (const [key, label, max] of [['name', 'Имя', 100], ['phone', 'Телефон', 40], ['group', 'Группа', 100]]) {
    if (!partial || Object.hasOwn(body, key)) result[key] = textField(body[key], label, max);
  }
  if (!partial || Object.hasOwn(body, 'monthlyFee')) result.monthlyFeeMinor = moneyToMinor(body.monthlyFee);
  return result;
}

export function paymentInput(body) {
  requireObject(body);
  if (Object.keys(body).some(key => !['studentId', 'amount', 'date'].includes(key))) {
    throw new HttpError(400, 'Допустимы только studentId, amount и date.');
  }
  return {
    studentId: positiveId(body.studentId),
    amountMinor: moneyToMinor(body.amount, { positive: true }),
    date: calendarDate(body.date),
  };
}
