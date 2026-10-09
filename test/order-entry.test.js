import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendSale,
  groupProductSalesByCategory,
  ledgerTotals,
  orderLines,
  readAmountMap,
} from '../src/lib/sales.js';
import { closingQuantity, isLowStock, prepareInventory } from '../src/lib/inventory.js';

const products = [
  { Name: 'Cheese', Price: 65 },
  { Name: 'Bacon', Price: 75 },
];

test('recording a sale adds to saved revenue without repricing history or dropping retired products', () => {
  const original = {
    Takoyaki_Sales: 210,
    Product_Sales_JSON: '{"Cheese":3,"Old menu item":2}',
    Staff_Expenses_JSON: '{"Former staff":100}',
    Previous_Cash_Added: 50,
    Payout_Mykah: 10,
  };
  const next = appendSale(original, products, { Cheese: 2, Bacon: 1 });
  assert.equal(next.Takoyaki_Sales, 415);
  assert.deepEqual(readAmountMap(next.Product_Sales_JSON), { Cheese: 5, 'Old menu item': 2, Bacon: 1 });
  assert.equal(next.Staff_Expenses_JSON, original.Staff_Expenses_JSON);
  assert.equal(next.Payout_Mykah, 10);
  assert.equal(original.Takoyaki_Sales, 210);
  assert.equal(appendSale(next, products, { Bacon: 1 }).Takoyaki_Sales, 490);
});

test('manual-only historical revenue and cent amounts survive an added order', () => {
  const next = appendSale({ Takoyaki_Sales: 123.45 }, [{ Name: 'Extra', Price: 0.1 }], { Extra: 3 });
  assert.equal(next.Takoyaki_Sales, 123.75);
  assert.equal(readAmountMap(next.Product_Sales_JSON).Extra, 3);
});

test('product sales are grouped by catalog category with historical items retained', () => {
  assert.deepEqual(
    groupProductSalesByCategory(
      { Cheese: 3, Bacon: 2, Soda: 4, Retired: 1, Empty: 0 },
      [
        { Name: 'Cheese', Category: 'Takoyaki', Price: 65 },
        { Name: 'Bacon', Category: 'Takoyaki', Price: 75 },
        { Name: 'Soda', Category: 'Drinks', Price: 20 },
      ],
    ),
    [
      {
        category: 'Takoyaki',
        items: [
          { name: 'Cheese', qty: 3, amount: 195 },
          { name: 'Bacon', qty: 2, amount: 150 },
        ],
        quantity: 5,
        amount: 345,
      },
      {
        category: 'Drinks',
        items: [{ name: 'Soda', qty: 4, amount: 80 }],
        quantity: 4,
        amount: 80,
      },
      {
        category: 'Uncategorized',
        items: [{ name: 'Retired', qty: 1, amount: 0 }],
        quantity: 1,
        amount: 0,
      },
    ],
  );
});

test('invalid or empty baskets cannot be recorded', () => {
  for (const qty of ['', 0, -1, 1.5, 'abc', Infinity]) {
    assert.throws(() => orderLines(products, { Cheese: qty }), /whole number/);
  }
  assert.throws(() => appendSale({}, products, {}), /at least one/);
  assert.throws(() => appendSale({}, products, { Cheese: 1, Missing: 1 }), /no longer available/);
  assert.throws(() => readAmountMap('broken json'));
  assert.throws(() => readAmountMap('[]'));
});

test('cash balance includes configured expenses, archived staff payouts, added cash and legacy payouts', () => {
  assert.deepEqual(
    ledgerTotals(
      {
        Takoyaki_Sales: 1000,
        Breakdown_Bill: 100,
        Staff_Expenses_JSON: '{"Former staff":200}',
        Previous_Cash_Added: 50,
        Payout_Mykah: 10,
        Payout_Natalie: 20,
      },
      [{ key: 'Breakdown_Bill' }],
    ),
    {
      sales: 1000,
      expenses: 300,
      addedCash: 50,
      payouts: 30,
      cash: 720,
    },
  );
});

test('inventory handles fractional stock and the low-stock boundary', () => {
  const item = { Product: 'Flour', Current_Qty: 0.1, In_Stock: 0.2, Out_Stock: 0, Threshold_Limit: 0.3 };
  assert.equal(closingQuantity(item), 0.3);
  assert.equal(isLowStock(item), true);
  assert.equal(prepareInventory([item])[0].Closing_Qty, 0.3);
});

test('inventory rejects invalid quantities and use beyond available stock', () => {
  const item = { Product: 'Flour', Current_Qty: 5, In_Stock: '', Out_Stock: 2 };
  assert.equal(prepareInventory([item])[0].Closing_Qty, 3);
  assert.throws(() => prepareInventory([{ ...item, In_Stock: -1 }]), /0 or more/);
  assert.throws(() => prepareInventory([{ ...item, Out_Stock: 'invalid' }]), /valid quantity/);
  assert.throws(() => prepareInventory([{ ...item, Out_Stock: 6 }]), /cannot exceed/);
});
