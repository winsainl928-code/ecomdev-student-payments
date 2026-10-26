import { defaultDbPath } from '../src/app.js';
import { openStore } from '../src/store.js';
import { paymentInput, studentInput } from '../src/validation.js';

const store = openStore(process.env.DB_PATH || defaultDbPath);
try {
  if (store.listStudents().length) {
    console.log('В базе уже есть ученики. Демоданные не добавлены.');
  } else {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const examples = [
      ['Демо · Алина', '000-000-01', 'Английский A2', '600000.00', '250000.00'],
      ['Демо · Тимур', '000-000-02', 'Математика', '450000.00', '450000.00'],
      ['Демо · Мадина', '000-000-03', 'Английский A2', '600000.00', null],
      ['Демо · Рустам', '000-000-04', 'Программирование', '800000.00', '900000.00'],
    ];
    for (const [name, phone, group, monthlyFee, amount] of examples) {
      const student = store.createStudent(studentInput({ name, phone, group, monthlyFee }));
      if (amount) store.createPayment(paymentInput({ studentId: student.id, amount, date: `${month}-01` }));
    }
    console.log(`Добавлены 4 вымышленных ученика и 3 оплаты за ${month}. Валюта интерфейса — UZS.`);
  }
} finally {
  store.close();
}
