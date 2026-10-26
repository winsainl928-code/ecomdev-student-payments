import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError, moneyFromMinor, monthRange } from './validation.js';

const studentJson = row => ({
  id: row.id, name: row.name, phone: row.phone, group: row.group_name,
  monthlyFee: moneyFromMinor(row.monthly_fee_minor),
});
const paymentJson = row => ({
  id: row.id, studentId: row.student_id,
  amount: moneyFromMinor(row.amount_minor), date: row.date,
});

export function openStore(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      group_name TEXT NOT NULL,
      monthly_fee_minor INTEGER NOT NULL CHECK(monthly_fee_minor >= 0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
      date TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS payments_student_date ON payments(student_id, date);
  `);

  function getStudentRow(id) {
    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Ученик не найден.');
    return row;
  }

  return {
    listStudents() {
      return db.prepare('SELECT * FROM students ORDER BY id').all().map(studentJson);
    },
    getStudent(id) { return studentJson(getStudentRow(id)); },
    createStudent(input) {
      const result = db.prepare(`
        INSERT INTO students (name, phone, group_name, monthly_fee_minor) VALUES (?, ?, ?, ?)
      `).run(input.name, input.phone, input.group, input.monthlyFeeMinor);
      return studentJson(getStudentRow(Number(result.lastInsertRowid)));
    },
    updateStudent(id, input) {
      const current = getStudentRow(id);
      db.prepare(`UPDATE students SET name = ?, phone = ?, group_name = ?, monthly_fee_minor = ? WHERE id = ?`)
        .run(input.name ?? current.name, input.phone ?? current.phone,
          input.group ?? current.group_name, input.monthlyFeeMinor ?? current.monthly_fee_minor, id);
      return studentJson(getStudentRow(id));
    },
    deleteStudent(id) {
      getStudentRow(id);
      db.prepare('DELETE FROM students WHERE id = ?').run(id);
    },
    listPayments(studentId) {
      getStudentRow(studentId);
      return db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY date DESC, id DESC')
        .all(studentId).map(paymentJson);
    },
    createPayment(input) {
      getStudentRow(input.studentId);
      const result = db.prepare('INSERT INTO payments (student_id, amount_minor, date) VALUES (?, ?, ?)')
        .run(input.studentId, input.amountMinor, input.date);
      return paymentJson(db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(result.lastInsertRowid)));
    },
    debtors(month) {
      const { start, end } = monthRange(month);
      const rows = db.prepare(`
        SELECT s.*, COALESCE(SUM(p.amount_minor), 0) AS paid_minor
        FROM students AS s
        LEFT JOIN payments AS p ON p.student_id = s.id AND p.date >= ? AND p.date <= ?
        GROUP BY s.id
        HAVING paid_minor < s.monthly_fee_minor
        ORDER BY (s.monthly_fee_minor - paid_minor) DESC, s.id
      `).all(start, end);
      let total = 0;
      const debtors = rows.map(row => {
        const debtMinor = row.monthly_fee_minor - row.paid_minor;
        total += debtMinor;
        return {
          studentId: row.id, name: row.name, phone: row.phone, group: row.group_name,
          monthlyFee: moneyFromMinor(row.monthly_fee_minor),
          paid: moneyFromMinor(row.paid_minor), debt: moneyFromMinor(debtMinor),
        };
      });
      return { month, debtors, totalDebt: moneyFromMinor(total) };
    },
    close() { db.close(); },
  };
}
