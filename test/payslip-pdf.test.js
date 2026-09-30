import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayslipPdf, payslipPdfFilename } from '../src/lib/payslipPdf.js';

const payslip = {
  staff: 'Ana Marie / Test',
  start: '2026-09-20',
  end: '2026-09-26',
  days: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-09-${20 + index}`,
    onDuty: index < 5,
    quotaHit: index < 3,
    overtimeHours: index === 1 ? 1.5 : 0,
    base: index < 5 ? 400 : 0,
    bonus: index < 3 ? 50 : 0,
    overtime: index === 1 ? 75 : 0,
    total: index < 5 ? 400 + (index < 3 ? 50 : 0) + (index === 1 ? 75 : 0) : 0,
  })),
  totals: { days: 5, quotaDays: 3, overtimeHours: 1.5, base: 2000, bonus: 150, overtime: 75, total: 2225 },
};

test('payslip PDF has a safe staff and date coverage filename and complete one-page content', () => {
  assert.equal(payslipPdfFilename(payslip), 'Ana_Marie_Test_2026-09-20_to_2026-09-26.pdf');
  const bytes = buildPayslipPdf(payslip);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /Ana Marie \/ Test/);
  assert.match(text, /2026-09-20 to 2026-09-26/);
  assert.match(text, /Total earnings/);
  assert.match(text, /PHP 2,225\.00/);
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 1);
  assert.match(text, /startxref\n\d+\n%%EOF/);
});
