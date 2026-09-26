import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayslip, normalizeAttendance, normalizePayroll } from '../src/lib/payroll.js';
import { appendSale, ledgerTotals, readCustomEntries } from '../src/lib/sales.js';
import { normalizeCatalog } from '../src/lib/admin.js';

const start = '2026-09-20';
const payroll = normalizePayroll({ staffRates: { Ana: { dailyRate: 400 } } });
const records = [
  { staff: 'Ana', date: start, onDuty: true, overtimeHours: 1.5 },
  { staff: 'Ana', date: '2026-09-21', onDuty: true, overtimeHours: 2 },
  { staff: 'Ana', date: '2026-09-22', onDuty: false },
];
const sales = { [start]: 4000, '2026-09-21': 4000.01, '2026-09-22': 5000 };

test('quota is strictly above 4000, applies only on duty, and fractional OT pays per hour', () => {
  const slip = buildPayslip('Ana', start, records, sales, payroll);
  assert.equal(slip.days[0].quotaHit, false);
  assert.equal(slip.days[1].quotaHit, true);
  assert.equal(slip.days[2].quotaHit, false);
  assert.deepEqual(slip.totals, {
    days: 2,
    quotaDays: 1,
    overtimeHours: 3.5,
    base: 800,
    bonus: 50,
    overtime: 175,
    total: 1025,
  });
  assert.equal(slip.missingRate, false);
});

test('each on-duty staff member earns their configured daily, quota and overtime rates', () => {
  const config = normalizePayroll({
    quotaTarget: 4000,
    staffRates: { Bea: { dailyRate: 500, quotaBonus: 75, otRate: 60 } },
  });
  const slip = buildPayslip(
    'Bea',
    start,
    [{ staff: 'Bea', date: start, onDuty: true, overtimeHours: 1.25 }],
    { [start]: 4200 },
    config,
  );
  assert.equal(slip.totals.total, 650);
  assert.equal(slip.totals.overtime, 75);
});

test('saved attendance keeps pay rates when current settings change', () => {
  const saved = normalizeAttendance(records, start, payroll);
  const changed = normalizePayroll({
    quotaTarget: 8000,
    staffRates: { Ana: { dailyRate: 900, quotaBonus: 10, otRate: 100 } },
  });
  const slip = buildPayslip('Ana', start, saved, sales, changed);
  assert.equal(slip.totals.total, 1025);
  assert.equal(slip.days[1].rates.quotaTarget, 4000);
  assert.equal(saved[0].rates.dailyRate, 400);
});

test('unconfigured daily pay is flagged; explicit zero is accepted', () => {
  assert.equal(buildPayslip('Ana', start, records, sales, normalizePayroll()).missingRate, true);
  assert.equal(
    buildPayslip('Ana', start, records, sales, normalizePayroll({ staffRates: { Ana: { dailyRate: 0 } } }))
      .missingRate,
    false,
  );
});

test('invalid attendance, rates and overtime are rejected before saving', () => {
  for (const overtimeHours of [-1, 25, 'wrong', Infinity])
    assert.throws(() => normalizeAttendance([{ ...records[0], overtimeHours }], start, payroll), /overtime/);
  assert.throws(() => normalizeAttendance([{ ...records[0], onDuty: false }], start, payroll), /on duty/);
  assert.throws(() => normalizeAttendance([records[0], records[0]], start, payroll), /Duplicate/);
  assert.throws(
    () => normalizeAttendance([{ ...records[0], date: '2026-09-19' }], start, payroll),
    /within this week/,
  );
  assert.throws(() => normalizePayroll({ staffRates: { Ana: { dailyRate: -1 } } }), /daily rate/);
  assert.throws(() => normalizePayroll({ quotaTarget: '' }), /required/);
});

test('custom-only and mixed orders accumulate once without repricing historical sales', () => {
  const first = appendSale({ Takoyaki_Sales: 100 }, [], {}, [{ description: 'Barkada mix', amount: '230' }]);
  assert.equal(first.Takoyaki_Sales, 330);
  const second = appendSale(first, [{ Name: 'Cheese', Price: 65 }], { Cheese: 2 }, [
    { description: 'Mix special', amount: 100.25 },
  ]);
  assert.equal(second.Takoyaki_Sales, 560.25);
  assert.equal(readCustomEntries(second.Custom_Sales_JSON).length, 2);
  assert.deepEqual(JSON.parse(second.Product_Sales_JSON), { Cheese: 2 });
  assert.equal(ledgerTotals(second, []).sales, 560.25);
});

test('custom expenses reduce cash balance alongside fixed expenses and staff payouts', () => {
  const row = {
    Takoyaki_Sales: 500,
    Breakdown_Gas: 50,
    Staff_Expenses_JSON: '{"Ana":100}',
    Custom_Expenses_JSON: '[{"description":"Delivery fee","amount":80},{"description":"Ice","amount":10.5}]',
  };
  assert.equal(ledgerTotals(row, [{ key: 'Breakdown_Gas' }]).expenses, 240.5);
  assert.equal(ledgerTotals(row, [{ key: 'Breakdown_Gas' }]).cash, 259.5);
  for (const entry of [
    { description: '', amount: 20 },
    { description: 'Fee', amount: -1 },
    { description: 'Fee', amount: 'oops' },
    { description: 'Fee', amount: 0 },
  ])
    assert.throws(() => readCustomEntries([entry]));
  assert.throws(() => readCustomEntries('{"amount":20}'));
});

test('rename payloads retain original identity and reject duplicate destination names', () => {
  assert.deepEqual(
    normalizeCatalog(
      [{ Product: 'New flour', Original_Name: 'Flour', Unit: 'kg', Threshold_Limit: 2 }],
      'items',
    )[0],
    { Product: 'New flour', Original_Name: 'Flour', Unit: 'kg', Threshold_Limit: 2 },
  );
  assert.equal(
    normalizeCatalog([{ Name: 'New menu name', Original_Name: 'Old menu name', Price: 230 }], 'products')[0]
      .Original_Name,
    'Old menu name',
  );
  assert.throws(
    () => normalizeCatalog([{ Name: 'Same', Original_Name: 'Old' }, { Name: 'same' }], 'products'),
    /already/,
  );
});
