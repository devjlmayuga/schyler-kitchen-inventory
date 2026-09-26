import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, buildReport, nextExpenseKey, normalizeCatalog, weekStart } from '../src/lib/admin.js';

test('reports retain all sales beyond 62 days and group long ranges by month', () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    Date: addDays('2026-01-01', index),
    Takoyaki_Sales: 100,
    Expenses_Total: 30,
    Product_Sales_JSON: '{"Cheese":2}',
  }));
  const result = buildReport(rows, '2026-01-01', '2026-04-30');
  assert.deepEqual(result.totals, { sales: 10000, expenses: 3000, net: 7000 });
  assert.equal(result.daily.length, 100);
  assert.equal(result.monthly, true);
  assert.equal(result.chart.length, 4);
  assert.equal(result.products[0].qty, 200);
  assert.equal(
    result.chart.reduce((sum, month) => sum + month.sales, 0),
    10000,
  );
});

test('reports filter dates, preserve negative net sales and handle totals without product details', () => {
  const result = buildReport(
    [
      {
        Date: '2026-01-01T00:00:00Z',
        Takoyaki_Sales: '1,000',
        Expenses_Total: 1100,
        Product_Sales_JSON: 'bad old data',
      },
      { Date: '2026-01-03', Takoyaki_Sales: 50, Expenses_Total: 10, Product_Sales_JSON: { Cheese: 1 } },
      { Date: '2025-12-31', Takoyaki_Sales: 9000 },
    ],
    '2026-01-01',
    '2026-01-03',
  );
  assert.equal(result.totals.net, -60);
  assert.equal(result.chart.length, 3);
  assert.equal(result.chart[1].sales, 0);
  assert.deepEqual(result.products, [{ name: 'Cheese', qty: 1 }]);
});

test('catalog validation rejects duplicate names and negative or invalid amounts before saving', () => {
  assert.throws(
    () =>
      normalizeCatalog(
        [
          { Product: 'Flour', Threshold_Limit: 1 },
          { Product: ' flour ', Threshold_Limit: 2 },
        ],
        'items',
      ),
    /already/,
  );
  assert.throws(() => normalizeCatalog([{ Product: 'Flour', Threshold_Limit: -1 }], 'items'), /0 or more/);
  assert.throws(() => normalizeCatalog([{ Name: 'Cheese', Price: 'invalid' }], 'products'), /0 or more/);
  assert.deepEqual(
    normalizeCatalog([{ Name: ' Cheese ', Category: ' Classic ', Price: '65.50', Active: 'N' }], 'products'),
    [{ Name: 'Cheese', Category: 'Classic', Price: 65.5, Active: 'N' }],
  );
});

test('expense keys remain unique when different labels produce the same slug', () => {
  const fields = [{ key: 'Breakdown_Gas_Ice' }, { key: 'Breakdown_Gas_Ice_2' }];
  assert.equal(nextExpenseKey('Gas & Ice', fields), 'Breakdown_Gas_Ice_3');
  assert.equal(nextExpenseKey('gas ice', fields), 'Breakdown_gas_ice_3');
});

test('attendance weeks start on Sunday and cross month/year boundaries correctly', () => {
  assert.equal(weekStart('2026-01-01'), '2025-12-28');
  assert.equal(weekStart('2026-09-27'), '2026-09-27');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
});
