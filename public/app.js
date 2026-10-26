'use strict';

const $ = (id) => document.getElementById(id);
const state = { students: [], debtors: [], reportMonth: null, loadSequence: 0, historySequence: 0, editingId: null, loading: false, mutation: false };
const moneyFormatter = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
let noticeTimer;
let paymentReturnFocus;

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showMessage(id, message) {
  $(id).textContent = message || '';
  $(id).hidden = !message;
}

function notify(message) {
  clearTimeout(noticeTimer);
  showMessage('notice', message);
  noticeTimer = setTimeout(() => showMessage('notice', ''), 6500);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
  } catch {
    if (path === '/payments' && options.method === 'POST') {
      throw new Error('Нет ответа от приложения. Перед повторным сохранением проверьте историю оплат: запись могла сохраниться.');
    }
    if (options.method && options.method !== 'GET') {
      throw new Error('Нет ответа от приложения. Обновите список перед повтором: изменение могло сохраниться.');
    }
    throw new Error('Нет связи с приложением. Проверьте, что оно запущено, и нажмите «Повторить».');
  }
  if (response.status === 204) return null;
  let result;
  try { result = await response.json(); } catch { throw new Error('Сервер вернул непонятный ответ. Попробуйте ещё раз.'); }
  if (!response.ok) throw new Error(result?.error || 'Не удалось выполнить запрос.');
  return result;
}

function money(value) { return moneyFormatter.format(Number(value)); }
function decimal(value) { return value.replace(/\s/g, '').replace(',', '.'); }

function matchesStudent(student, value) {
  const query = value.trim().toLocaleLowerCase('ru');
  if (`${student.name} ${student.group} ${student.phone} #${student.id ?? student.studentId}`.toLocaleLowerCase('ru').includes(query)) return true;
  const digits = query.replace(/\D/g, '');
  return /^[+\d\s()-]+$/.test(query) && digits.length > 0 && student.phone.replace(/\D/g, '').includes(digits);
}

function updateControls() {
  const reportReady = !state.loading && state.reportMonth === $('month').value;
  for (const element of document.querySelectorAll('#payment-form input, #payment-form select, #payment-form button')) {
    element.disabled = state.mutation || !reportReady || !state.students.length;
  }
  for (const element of document.querySelectorAll('#student-form input, #student-form button')) element.disabled = state.mutation;
  for (const element of document.querySelectorAll('[data-record-action]')) element.disabled = state.mutation || !reportReady;
  $('header-add-payment').disabled = state.mutation || !reportReady || !state.students.length;
  $('header-add-student').disabled = state.mutation;
  $('add-student-button').disabled = state.mutation;
  $('month').disabled = state.mutation;
  $('current-month-button').disabled = state.mutation;
  $('payment-history-button').disabled = state.mutation || state.loading;
  $('close-payment-dialog').disabled = state.mutation;
  $('payment-done-button').disabled = state.mutation;
}

function openPaymentDialog(focusId = 'payment-student') {
  if (state.mutation || state.loading || state.reportMonth !== $('month').value) return;
  $('payment-form').hidden = false;
  $('payment-intro').hidden = false;
  $('payment-result').hidden = true;
  $('payment-done-button').hidden = true;
  showMessage('payment-error', '');
  if (!$('payment-dialog').open) {
    paymentReturnFocus = document.activeElement;
    $('payment-dialog').showModal();
    $('payment-dialog').scrollTop = 0;
  }
  $(focusId).focus({ preventScroll: true });
  if (focusId === 'payment-amount') $('payment-amount').select();
}

function closePaymentDialog() {
  if (!state.mutation) $('payment-dialog').close();
}

function choosePaymentStudent(studentId, amount = '') {
  if (state.mutation || state.loading || state.reportMonth !== $('month').value || !state.students.some((item) => item.id === studentId)) return;
  $('payment-student').value = String(studentId);
  $('payment-amount').value = amount ? money(amount) : '';
  showMessage('payment-error', '');
  $('payment-result').hidden = true;
  updatePaymentContext();
  openPaymentDialog('payment-amount');
}

function showStudentHistory(studentId) {
  closePaymentDialog();
  $('history-student').value = String(studentId);
  switchView('history', true);
  document.querySelector('.records-panel').scrollIntoView({ block: 'start' });
}

function monthLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, monthNumber - 1, 1);
  return monthFormatter.format(date).replace(/\s*г\.$/, '');
}

function updatePaymentContext() {
  const selectedId = Number($('payment-student').value);
  const student = state.students.find((item) => item.id === selectedId);
  const context = $('payment-context');
  context.hidden = !student || state.loading || !state.reportMonth;
  $('payment-history-button').hidden = !student;
  if (!context.hidden) {
    const debtor = state.debtors.find((item) => item.studentId === selectedId);
    const details = debtor
      ? `Внесено ${money(debtor.paid)} из ${money(debtor.monthlyFee)} UZS. Осталось ${money(debtor.debt)} UZS.`
      : 'Задолженности за этот месяц нет. Новую оплату можно записать в историю.';
    context.replaceChildren(node('strong', '', student.name), node('span', '', `${student.group} · ${student.phone}`), node('span', '', monthLabel(state.reportMonth)), node('p', '', details));
  }
  const paymentMonth = $('payment-date').value.slice(0, 7);
  const reportMonth = $('month').value;
  const differentMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(paymentMonth)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(reportMonth) && paymentMonth !== reportMonth;
  showMessage('payment-period-hint', differentMonth
    ? `Месяц оплаты: ${monthLabel(paymentMonth)}. В отчёте за ${monthLabel(reportMonth)} долг не изменится.`
    : '');
  const amount = decimal($('payment-amount').value);
  const debtor = state.debtors.find((item) => item.studentId === selectedId);
  const fillRemaining = $('fill-remaining');
  fillRemaining.hidden = context.hidden || !debtor || paymentMonth !== state.reportMonth;
  if (!fillRemaining.hidden) fillRemaining.textContent = `Весь остаток: ${money(debtor.debt)} UZS`;
  let effect = '';
  if (!context.hidden && debtor && !differentMonth && paymentMonth === state.reportMonth && /^\d+(\.\d{1,2})?$/.test(amount)) {
    const [whole, fraction = ''] = amount.split('.');
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    const debtMinor = Number(debtor.debt.replace('.', ''));
    if (Number.isSafeInteger(minor) && minor > 0 && minor <= 99999999999) {
      const remaining = debtMinor - minor;
      effect = remaining > 0 ? `После оплаты останется ${money((remaining / 100).toFixed(2))} UZS.`
        : remaining === 0 ? 'После оплаты долг за этот месяц будет погашен.'
          : `Сверх долга: ${money((-remaining / 100).toFixed(2))} UZS. Переплата не переносится на следующий месяц.`;
    }
  }
  showMessage('payment-effect', effect);
}

function setBusy(button, busy, busyText, normalText) {
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  button.textContent = busy ? busyText : normalText;
}

function emptyState(target, title, description, action) {
  const wrap = node('div', 'empty-state');
  wrap.append(node('strong', '', title), node('span', '', description));
  if (action) {
    wrap.append(document.createElement('br'));
    const button = node('button', 'button button-secondary button-small', action.label);
    button.type = 'button';
    button.addEventListener('click', action.run);
    wrap.append(button);
  }
  $(target).replaceChildren(wrap);
}

function makeTable(className, headings) {
  const table = node('table', className);
  const head = node('thead');
  const row = node('tr');
  for (const heading of headings) {
    const cell = node('th', '', heading);
    cell.scope = 'col';
    row.append(cell);
  }
  head.append(row);
  table.append(head, node('tbody'));
  return table;
}

function personCell(student) {
  const cell = node('td');
  const person = node('div', 'person-cell');
  const initials = student.name.replace(/^Демо\s*·\s*/i, '').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('ru');
  const avatar = node('span', 'person-avatar', initials);
  avatar.setAttribute('aria-hidden', 'true');
  const details = node('div');
  details.append(node('div', 'person-name', student.name), node('div', 'person-detail', student.phone), node('div', 'person-group', student.group));
  person.append(avatar, details);
  cell.append(person);
  return cell;
}

function amountCell(value, detail, extraClass = '') {
  const cell = node('td', `amount ${extraClass}`, money(value));
  if (detail) cell.append(node('small', '', detail));
  return cell;
}

function renderDebtors() {
  const filter = $('debtor-search').value.trim().toLocaleLowerCase('ru');
  const status = $('debtor-filter').value;
  const filtered = Boolean(filter) || status !== 'all';
  const debtors = state.debtors.filter((item) => matchesStudent(item, filter)
    && (status === 'all' || (status === 'partial' ? Number(item.paid) > 0 : Number(item.paid) === 0)));
  $('debtors-shown').textContent = `${debtors.length} из ${state.debtors.length}`;
  if (!state.students.length) {
    emptyState('debtors-content', 'Начнём с первого ученика', 'Добавьте ученика и месячную стоимость — задолженность рассчитается автоматически.', { label: 'Добавить ученика', run: () => openStudentDialog() });
    return;
  }
  if (!debtors.length) {
    emptyState('debtors-content', filtered ? 'Ничего не найдено' : 'За этот месяц долгов нет', filtered ? 'Попробуйте другое имя или измените статус оплаты.' : 'У всех учеников внесена полная месячная сумма.', filtered ? { label: 'Сбросить фильтры', run: () => { $('debtor-search').value = ''; $('debtor-filter').value = 'all'; renderDebtors(); } } : undefined);
    return;
  }
  const table = makeTable('debt-table', ['Ученик', 'В месяц', 'Внесено', 'Осталось', '']);
  const body = table.tBodies[0];
  for (const debtor of debtors) {
    const row = node('tr');
    const actionCell = node('td');
    const pay = node('button', 'row-action', 'Внести оплату');
    pay.type = 'button';
    pay.dataset.recordAction = '';
    pay.disabled = state.mutation;
    pay.setAttribute('aria-label', `Внести оплату: ${debtor.name}`);
    pay.addEventListener('click', () => choosePaymentStudent(debtor.studentId, debtor.debt));
    actionCell.append(pay);
    const feeCell = amountCell(debtor.monthlyFee);
    const paidCell = amountCell(debtor.paid, Number(debtor.paid) > 0 ? 'Частичная оплата' : 'Ещё не платил', 'paid-amount');
    const debtCell = amountCell(debtor.debt, undefined, 'debt-amount');
    feeCell.dataset.label = 'В месяц';
    paidCell.dataset.label = 'Внесено';
    debtCell.dataset.label = 'Осталось';
    row.append(personCell(debtor), feeCell, paidCell, debtCell, actionCell);
    body.append(row);
  }
  $('debtors-content').replaceChildren(table);
}

function renderStudents() {
  if (!state.students.length) {
    emptyState('students-content', 'Ученики ещё не добавлены', 'Создайте карточку ученика, чтобы вносить оплаты и видеть задолженность.', { label: 'Добавить ученика', run: () => openStudentDialog() });
    return;
  }
  const students = state.students.filter((student) => matchesStudent(student, $('student-search').value));
  if (!students.length) {
    emptyState('students-content', 'Ученики не найдены', 'Проверьте имя, группу или телефон.', { label: 'Сбросить поиск', run: () => { $('student-search').value = ''; renderStudents(); } });
    return;
  }
  const table = makeTable('student-table', ['Ученик', 'Группа', 'В месяц, UZS', 'Действия']);
  for (const student of students) {
    const row = node('tr');
    const groupCell = node('td');
    groupCell.append(node('span', 'group-chip', student.group));
    const actions = node('td');
    const actionGroup = node('div', 'row-actions');
    const pay = node('button', 'row-action', 'Внести оплату');
    pay.type = 'button';
    pay.setAttribute('aria-label', `Внести оплату: ${student.name}`);
    pay.addEventListener('click', () => choosePaymentStudent(student.id));
    const history = node('button', 'row-action', 'История');
    history.type = 'button';
    history.setAttribute('aria-label', `История оплат: ${student.name}`);
    history.addEventListener('click', () => showStudentHistory(student.id));
    const edit = node('button', 'row-action', 'Изменить');
    edit.type = 'button';
    edit.dataset.editStudentId = String(student.id);
    edit.setAttribute('aria-label', `Изменить ученика: ${student.name}`);
    edit.addEventListener('click', () => openStudentDialog(student));
    const remove = node('button', 'row-action delete-action', 'Удалить');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Удалить ученика: ${student.name}`);
    remove.addEventListener('click', () => deleteStudent(student, remove));
    for (const action of [pay, history, edit, remove]) {
      action.dataset.recordAction = '';
      action.disabled = state.mutation;
    }
    actionGroup.append(pay, history, edit, remove);
    actions.append(actionGroup);
    const feeCell = amountCell(student.monthlyFee, 'UZS в месяц');
    row.append(personCell(student), groupCell, feeCell, actions);
    table.tBodies[0].append(row);
  }
  $('students-content').replaceChildren(table);
}

function refreshStudentOptions(id) {
  const select = $(id);
  const previous = select.value;
  const placeholder = node('option', '', state.students.length ? 'Выберите ученика' : 'Сначала добавьте ученика');
  placeholder.value = '';
  const options = [...state.students].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((student) => {
    const option = node('option', '', `${student.name} · ${student.group} · ${student.phone} · #${student.id}`);
    option.value = String(student.id);
    return option;
  });
  select.replaceChildren(placeholder, ...options);
  select.value = state.students.some((student) => String(student.id) === previous) ? previous : '';
  select.disabled = !state.students.length;
}

async function loadAll() {
  const request = ++state.loadSequence;
  const month = $('month').value;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) {
    state.loading = false;
    state.reportMonth = null;
    updatePaymentContext();
    updateControls();
    $('global-error-text').textContent = 'Выберите расчётный месяц в формате ГГГГ-ММ.';
    $('global-error').hidden = false;
    for (const id of ['total-debt', 'debtors-count', 'students-count', 'nav-debtors-count', 'clear-count', 'debtors-shown']) $(id).textContent = '—';
    $('paid-progress').value = 0;
    $('progress-caption').textContent = 'Выберите месяц для расчёта.';
    $('debtors-period').textContent = 'Месяц не выбран';
    for (const id of ['debtors-content', 'students-content']) {
      $(id).removeAttribute('aria-busy');
      emptyState(id, 'Выберите месяц', 'Укажите месяц над сводкой, чтобы загрузить данные.');
    }
    return false;
  }
  state.loading = true;
  updatePaymentContext();
  updateControls();
  $('current-month-button').hidden = month === localDate().slice(0, 7);
  $('global-error').hidden = true;
  $('total-debt').textContent = '…';
  $('debtors-count').textContent = '…';
  $('students-count').textContent = '…';
  $('nav-debtors-count').textContent = '…';
  $('clear-count').textContent = '…';
  $('debtors-shown').textContent = '';
  $('paid-progress').value = 0;
  $('progress-caption').textContent = 'Обновляем расчёт…';
  $('debtors-content').setAttribute('aria-busy', 'true');
  $('students-content').setAttribute('aria-busy', 'true');
  $('debtors-period').textContent = 'Загружаем данные…';
  emptyState('debtors-content', 'Загружаем задолженности…', 'Обновляем расчёт за выбранный месяц.');
  emptyState('students-content', 'Загружаем учеников…', 'Получаем актуальный список.');
  try {
    const [students, result] = await Promise.all([api('/students'), api(`/debtors?month=${encodeURIComponent(month)}`)]);
    if (request !== state.loadSequence) return false;
    state.students = students;
    state.debtors = result.debtors;
    state.reportMonth = month;
    $('total-debt').textContent = money(result.totalDebt);
    $('debtors-count').textContent = String(result.debtors.length);
    $('students-count').textContent = String(students.length);
    $('nav-debtors-count').textContent = String(result.debtors.length);
    const cleared = students.length - result.debtors.length;
    $('clear-count').textContent = String(cleared);
    $('paid-progress').value = students.length ? cleared / students.length * 100 : 0;
    $('progress-caption').textContent = students.length ? `${cleared} из ${students.length} учеников без задолженности` : 'Добавьте первого ученика, чтобы начать учёт.';
    $('debtors-period').textContent = monthLabel(month);
    refreshStudentOptions('payment-student');
    refreshStudentOptions('history-student');
    $('save-payment-button').disabled = !students.length || state.mutation;
    $('no-students-hint').hidden = students.length > 0;
    renderDebtors();
    renderStudents();
    if (!$('view-history').hidden) await loadHistory();
    return true;
  } catch (error) {
    if (request !== state.loadSequence) return;
    state.reportMonth = null;
    $('global-error-text').textContent = `Не удалось обновить данные. ${error.message}`;
    $('global-error').hidden = false;
    $('debtors-period').textContent = 'Данные не загружены';
    $('total-debt').textContent = '—';
    $('debtors-count').textContent = '—';
    $('students-count').textContent = '—';
    $('nav-debtors-count').textContent = '—';
    $('clear-count').textContent = '—';
    $('paid-progress').value = 0;
    $('progress-caption').textContent = 'Не удалось обновить расчёт.';
    emptyState('debtors-content', 'Не удалось загрузить данные', 'Проверьте, что сервер запущен, и нажмите «Повторить».');
    emptyState('students-content', 'Не удалось загрузить данные', 'Попробуйте обновить данные ещё раз.');
    return false;
  } finally {
    if (request === state.loadSequence) {
      state.loading = false;
      $('debtors-content').removeAttribute('aria-busy');
      $('students-content').removeAttribute('aria-busy');
      updatePaymentContext();
      updateControls();
    }
  }
}

async function loadHistory() {
  const request = ++state.historySequence;
  const studentId = $('history-student').value;
  if (!studentId) {
    emptyState('history-content', 'Выберите ученика', 'Здесь появятся все его оплаты независимо от расчётного месяца.');
    return;
  }
  emptyState('history-content', 'Загружаем историю…', 'Получаем оплаты выбранного ученика.');
  try {
    const payments = await api(`/students/${encodeURIComponent(studentId)}/payments`);
    if (request !== state.historySequence) return;
    if (!payments.length) {
      emptyState('history-content', 'Оплат пока нет', 'Добавьте первый платёж в форме «Внести оплату».');
      return;
    }
    const table = makeTable('history-table', ['Дата оплаты', 'Сумма, UZS', 'Номер']);
    for (const payment of payments) {
      const row = node('tr');
      const parts = payment.date.split('-');
      row.append(node('td', '', `${parts[2]}.${parts[1]}.${parts[0]}`), amountCell(payment.amount), node('td', 'person-detail', `#${payment.id}`));
      table.tBodies[0].append(row);
    }
    $('history-content').replaceChildren(table);
  } catch (error) {
    if (request !== state.historySequence) return;
    emptyState('history-content', 'История не загрузилась', error.message, { label: 'Повторить', run: () => loadHistory() });
  }
}

function switchView(view, focus = false) {
  const headings = {
    debtors: ['Оплаты и долги', 'Всё, что нужно для учёта оплаты за обучение.'],
    students: ['Ученики центра', 'Добавляйте учеников и управляйте их данными.'],
    history: ['История оплат', 'Проверьте, когда и сколько внёс ученик.'],
  };
  $('page-title').textContent = headings[view][0];
  $('page-description').textContent = headings[view][1];
  $('overview').hidden = view !== 'debtors';
  for (const tab of document.querySelectorAll('[data-view]')) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`view-${tab.dataset.view}`).hidden = !active;
    if (active && focus) tab.focus();
  }
  if (view === 'history') loadHistory();
}

function openStudentDialog(student = null) {
  if (state.mutation) return;
  state.editingId = student ? student.id : null;
  $('student-form').reset();
  showMessage('student-error', '');
  $('student-dialog-title').textContent = student ? 'Изменить ученика' : 'Новый ученик';
  $('save-student-button').textContent = student ? 'Сохранить изменения' : 'Добавить ученика';
  $('student-fee-note').hidden = !student;
  if (student) {
    $('student-name').value = student.name;
    $('student-phone').value = student.phone;
    $('student-group').value = student.group;
    $('student-fee').value = student.monthlyFee;
  }
  $('student-dialog').showModal();
  $('student-dialog').scrollTop = 0;
  $('student-name').focus({ preventScroll: true });
}

function closeStudentDialog() {
  if (!state.mutation) $('student-dialog').close();
}

async function deleteStudent(student, button) {
  if (state.mutation) return;
  if (!window.confirm(`Удалить ученика «${student.name}» и всю его историю оплат? Это действие нельзя отменить.`)) return;
  state.mutation = true;
  updateControls();
  button.disabled = true;
  try {
    await api(`/students/${student.id}`, { method: 'DELETE' });
    notify('Ученик и его история оплат удалены.');
    await loadAll();
  } catch (error) {
    $('global-error-text').textContent = error.message;
    $('global-error').hidden = false;
  } finally {
    state.mutation = false;
    updateControls();
  }
}

$('payment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.mutation) return;
  state.mutation = true;
  updateControls();
  const button = $('save-payment-button');
  setBusy(button, true, 'Сохраняем…', 'Сохранить оплату');
  showMessage('payment-error', '');
  $('payment-result').hidden = true;
  try {
    const studentId = Number($('payment-student').value);
    const student = state.students.find((item) => item.id === studentId);
    const payment = await api('/payments', { method: 'POST', body: JSON.stringify({ studentId, amount: decimal($('payment-amount').value), date: $('payment-date').value }) });
    $('payment-amount').value = '';
    const displayDate = payment.date.split('-').reverse().join('.');
    $('payment-result').replaceChildren(node('strong', '', 'Оплата сохранена'), node('span', '', `${money(payment.amount)} UZS · ${student.name}`), node('span', '', displayDate));
    $('payment-result').hidden = false;
    $('payment-form').hidden = true;
    $('payment-intro').hidden = true;
    $('payment-done-button').hidden = false;
    notify(`Оплата ${money(payment.amount)} UZS сохранена: ${student.name}.`);
    await loadAll();
  } catch (error) {
    showMessage('payment-error', error.message);
  } finally {
    state.mutation = false;
    setBusy(button, false, '', 'Сохранить оплату');
    button.disabled = !state.students.length;
    updateControls();
    const feedback = $('payment-error').hidden ? $('payment-result') : $('payment-error');
    if (!feedback.hidden) {
      feedback.tabIndex = -1;
      feedback.focus({ preventScroll: true });
      feedback.scrollIntoView({ block: 'nearest' });
    }
  }
});

$('student-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.mutation) return;
  state.mutation = true;
  updateControls();
  const editingId = state.editingId;
  const button = $('save-student-button');
  const normalText = editingId ? 'Сохранить изменения' : 'Добавить ученика';
  let createdId;
  setBusy(button, true, 'Сохраняем…', normalText);
  showMessage('student-error', '');
  try {
    const payload = { name: $('student-name').value.trim(), phone: $('student-phone').value.trim(), group: $('student-group').value.trim(), monthlyFee: decimal($('student-fee').value) };
    const student = await api(editingId ? `/students/${editingId}` : '/students', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    $('student-dialog').close();
    notify(editingId ? 'Изменения сохранены.' : 'Ученик добавлен. Теперь можно внести оплату.');
    const refreshed = await loadAll();
    if (!refreshed) {
      notify(`${editingId ? 'Изменения сохранены' : 'Ученик добавлен'}, но список не обновился. Нажмите «Повторить».`);
      return;
    }
    if (!editingId) $('payment-student').value = String(student.id);
    if (!editingId) createdId = student.id;
    updatePaymentContext();
  } catch (error) {
    showMessage('student-error', error.message);
  } finally {
    state.mutation = false;
    setBusy(button, false, '', normalText);
    $('save-payment-button').disabled = !state.students.length;
    updateControls();
    if (createdId) choosePaymentStudent(createdId);
    else if (editingId && !$('student-dialog').open) {
      const trigger = document.querySelector(`[data-edit-student-id="${editingId}"]`);
      (trigger || $('add-student-button')).focus({ preventScroll: true });
    }
  }
});

for (const tab of document.querySelectorAll('[data-view]')) {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
  tab.addEventListener('keydown', (event) => {
    const tabs = [...document.querySelectorAll('[data-view]')];
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault();
    switchView(tabs[index].dataset.view, true);
  });
}

$('month').value = localDate().slice(0, 7);
$('payment-date').value = localDate();
$('month').addEventListener('change', () => loadAll());
$('debtor-search').addEventListener('input', () => { if (!state.loading && state.reportMonth === $('month').value) renderDebtors(); });
$('debtor-filter').addEventListener('change', () => { if (!state.loading && state.reportMonth === $('month').value) renderDebtors(); });
$('history-student').addEventListener('change', () => loadHistory());
$('payment-student').addEventListener('change', () => {
  $('payment-amount').value = '';
  $('payment-result').hidden = true;
  showMessage('payment-error', '');
  updatePaymentContext();
});
function updatePaymentDraft() {
  showMessage('payment-error', '');
  updatePaymentContext();
}
$('payment-amount').addEventListener('input', updatePaymentDraft);
$('fill-remaining').addEventListener('click', () => {
  if (state.mutation || state.loading || state.reportMonth !== $('month').value
    || $('payment-date').value.slice(0, 7) !== state.reportMonth) return;
  const debtor = state.debtors.find((item) => item.studentId === Number($('payment-student').value));
  if (!debtor) return;
  $('payment-amount').value = money(debtor.debt);
  updatePaymentDraft();
  $('payment-amount').focus();
  $('payment-amount').select();
});
$('payment-date').addEventListener('change', updatePaymentDraft);
$('student-search').addEventListener('input', () => { if (!state.loading && state.reportMonth === $('month').value) renderStudents(); });
$('header-add-student').addEventListener('click', () => openStudentDialog());
$('header-add-payment').addEventListener('click', () => {
  $('payment-student').value = '';
  $('payment-amount').value = '';
  updatePaymentContext();
  openPaymentDialog();
});
$('payment-history-button').addEventListener('click', () => showStudentHistory(Number($('payment-student').value)));
$('current-month-button').addEventListener('click', () => { $('month').value = localDate().slice(0, 7); loadAll(); });
$('retry-button').addEventListener('click', () => loadAll());
$('add-student-button').addEventListener('click', () => openStudentDialog());
$('close-student-dialog').addEventListener('click', closeStudentDialog);
$('cancel-student-dialog').addEventListener('click', closeStudentDialog);
$('student-dialog').addEventListener('cancel', (event) => { if (state.mutation) event.preventDefault(); });
$('close-payment-dialog').addEventListener('click', closePaymentDialog);
$('cancel-payment-dialog').addEventListener('click', closePaymentDialog);
$('payment-done-button').addEventListener('click', closePaymentDialog);
$('payment-dialog').addEventListener('cancel', (event) => { if (state.mutation) event.preventDefault(); });
$('payment-dialog').addEventListener('close', () => {
  // Refreshing the debt table can remove the button that opened the dialog.
  const target = paymentReturnFocus?.isConnected && !paymentReturnFocus.disabled
    && paymentReturnFocus.getClientRects().length ? paymentReturnFocus : $('header-add-payment');
  const active = document.activeElement;
  if (!document.querySelector('dialog[open]') && (active === document.body || $('payment-dialog').contains(active))) {
    target.focus({ preventScroll: true });
  }
});
const mobileNavigation = window.matchMedia('(max-width:760px)');
function syncNavigation() { document.querySelector('.tabs').setAttribute('aria-orientation', mobileNavigation.matches ? 'horizontal' : 'vertical'); }
mobileNavigation.addEventListener('change', syncNavigation);
syncNavigation();
loadAll();
