import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrderRequest, priceOrder, addOrderToLedger, validBusinessDate } from '../src/lib/pos.js';
import { escPosReceipt, printerText, receiptLines } from '../src/lib/receipt.js';

const id = '14f956b9-d0fa-4011-bbad-7d7a32796a17';
const products = [{ Name: 'Cheese', Price: 65, Active: 'Y' }];
const request = (extra = {}) =>
  normalizeOrderRequest({
    id,
    date: '2026-09-26',
    items: [
      { kind: 'menu', name: 'Cheese', unitPrice: 65, quantity: 2 },
      { kind: 'custom', name: 'Barkada mix', unitPrice: 230.1, quantity: 1 },
    ],
    ...extra,
  });

test('POS prices orders in cents, accepts custom lines, and calculates exact cash/change', () => {
  const order = priceOrder(request({ cashReceived: 500 }), products);
  assert.equal(order.total, 360.1);
  assert.equal(order.change, 139.9);
  assert.equal(priceOrder(request(), products).cashReceived, 360.1);
  assert.equal(priceOrder(request(), products).change, 0);
});

test('server rejects stale or unavailable menu prices and insufficient cash', () => {
  assert.throws(() => priceOrder(request(), [{ Name: 'Cheese', Price: 70 }]), /price has changed/);
  assert.throws(
    () => priceOrder(request(), [{ Name: 'Cheese', Price: 65, Active: 'N' }]),
    /no longer available/,
  );
  assert.throws(() => priceOrder(request({ cashReceived: 300 }), products), /cover the order/);
});

test('POS validates identity, dates, quantities, lengths and duplicate menu items', () => {
  for (const quantity of [0, -1, 1.5, 1000, 'oops'])
    assert.throws(() => request({ items: [{ kind: 'menu', name: 'Cheese', unitPrice: 65, quantity }] }));
  assert.throws(() => request({ id: 'not-an-id' }));
  assert.throws(() => request({ date: '2026-02-30' }));
  assert.equal(validBusinessDate('2024-02-29'), true);
  assert.throws(() => request({ items: [] }));
  assert.throws(() => request({ customer: 'a'.repeat(81) }));
  assert.throws(() => request({ items: [{ kind: 'custom', name: 'Mix', unitPrice: -1, quantity: 1 }] }));
  assert.throws(() => request({ items: [...request().items, request().items[0]] }), /appears twice/);
});

test('POS preserves legacy revenue, item counts, expenses and adds custom amounts only once', () => {
  const order = priceOrder(request(), products);
  const original = {
    Takoyaki_Sales: 1000,
    Product_Sales_JSON: '{"Retired":3,"Cheese":1}',
    Custom_Sales_JSON: '[{"description":"Old mix","amount":100}]',
    Breakdown_Bill: 20,
    Staff_Expenses_JSON: '{"Ana":100}',
    Revision: 5,
  };
  const next = addOrderToLedger(original, order);
  assert.equal(next.Takoyaki_Sales, 1360.1);
  assert.deepEqual(JSON.parse(next.Product_Sales_JSON), { Retired: 3, Cheese: 3 });
  assert.equal(JSON.parse(next.Custom_Sales_JSON).length, 2);
  assert.equal(next.Breakdown_Bill, 20);
  assert.equal(next.Staff_Expenses_JSON, original.Staff_Expenses_JSON);
});

test('thermal slips wrap both widths, show saved amounts and strip printer control bytes from user text', () => {
  const order = {
    ...priceOrder(request(), products),
    number: '15',
    createdAt: '2026-09-26T10:00:00Z',
    customer: 'José\x1b@',
    notes: 'A'.repeat(150),
    cashier: 'Ana',
  };
  for (const width of [32, 48]) assert.ok(receiptLines(order, width).every((line) => line.length <= width));
  assert.equal(printerText('José\x1b\x00@ ₱50'), 'Jose @ PHP 50');
  const bytes = escPosReceipt(order);
  assert.deepEqual([...bytes.slice(0, 2)], [27, 64]);
  const text = new TextDecoder().decode(bytes.slice(8));
  assert.match(text, /#000015/);
  assert.match(text, /360.10/);
  assert.match(text, /Barkada mix/);
  assert.ok(!text.includes('\x1b'));
  assert.deepEqual([...escPosReceipt(order, { cut: true }).slice(-3)], [29, 86, 1]);
});

test('direct Bluetooth writes in ordered small chunks, handles disconnects and prevents overlapping print jobs', async () => {
  const { connectPrinter, sendReceipt, disconnectPrinter, printerStatus } =
    await import('../src/lib/printer.js');
  const writes = [];
  let fail = false;
  const characteristic = {
    properties: { write: true },
    async writeValueWithResponse(bytes) {
      if (fail) throw new Error('offline');
      writes.push([...bytes]);
    },
  };
  const device = {
    name: 'Mock BLE printer',
    addEventListener() {},
    gatt: {
      connected: false,
      async connect() {
        this.connected = true;
        return {
          async getPrimaryService() {
            return {
              async getCharacteristic() {
                return characteristic;
              },
            };
          },
        };
      },
      disconnect() {
        this.connected = false;
      },
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      bluetooth: {
        async requestDevice() {
          return device;
        },
      },
    },
  });
  globalThis.window = { isSecureContext: true };
  const settings = { method: 'bluetooth', service: 'ffe0', characteristic: 'ffe1', paperWidth: 58 };
  const order = { ...priceOrder(request(), products), number: 1, createdAt: '2026-09-26T10:00:00Z' };
  await connectPrinter(settings);
  assert.equal(printerStatus().connected, true);
  const sending = sendReceipt(order, settings);
  await assert.rejects(sendReceipt(order, settings), /already being sent/);
  await sending;
  assert.ok(writes.length > 1);
  assert.ok(writes.every((chunk) => chunk.length <= 20));
  assert.deepEqual(writes.flat(), [...escPosReceipt(order, settings)]);
  fail = true;
  await assert.rejects(sendReceipt(order, settings), /sale is saved/);
  assert.equal(printerStatus().connected, false);
  await disconnectPrinter();
});

test('direct serial printing releases its writer and closes a failed connection without retrying the sale', async () => {
  const { connectPrinter, sendReceipt, disconnectPrinter, printerStatus } =
    await import('../src/lib/printer.js');
  const chunks = [];
  let released = 0;
  let aborted = 0;
  let closed = 0;
  let fail = false;
  const writer = {
    async write(chunk) {
      if (fail) throw new Error('Printer offline');
      chunks.push(...chunk);
    },
    async abort() {
      aborted++;
    },
    releaseLock() {
      released++;
    },
  };
  const port = {
    writable: {
      getWriter() {
        return writer;
      },
    },
    async open(options) {
      assert.equal(options.baudRate, 9600);
    },
    async close() {
      closed++;
    },
    addEventListener() {},
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serial: {
        async requestPort() {
          return port;
        },
      },
    },
  });
  globalThis.window = { isSecureContext: true };
  const settings = { method: 'serial', paperWidth: 80, baudRate: 9600 };
  const order = { ...priceOrder(request(), products), number: 1, createdAt: '2026-09-26T10:00:00Z' };
  await connectPrinter(settings);
  await sendReceipt(order, settings);
  assert.deepEqual(chunks, [...escPosReceipt(order, settings)]);
  assert.equal(released, 1);
  fail = true;
  await assert.rejects(sendReceipt(order, settings), /sale is saved/);
  assert.equal(aborted, 1);
  assert.equal(released, 2);
  assert.equal(closed, 1);
  assert.equal(printerStatus().connected, false);
  await disconnectPrinter();
});

test('corrections replace only the selected order, retaining legacy totals and identical custom sales', async () => {
  const { replaceOrderInLedger, normalizeOrderEdit } = await import('../src/lib/pos.js');
  const original = priceOrder(request(), products);
  const baseline = {
    Takoyaki_Sales: 500,
    Product_Sales_JSON: '{"Retired":3}',
    Breakdown_Bill: 80,
    Staff_Expenses_JSON: '{"Ana":100}',
  };
  const twoOrders = addOrderToLedger(addOrderToLedger(baseline, original), original);
  const correctedRequest = normalizeOrderEdit({
    ...request(),
    revision: 1,
    editId: id,
    reason: 'Wrong quantity',
    items: [
      { kind: 'menu', name: 'Cheese', quantity: 1, unitPrice: 60 },
      { kind: 'custom', name: 'Small mix', quantity: 2, unitPrice: 100 },
    ],
    cashReceived: 300,
  });
  // Even an archived/renamed item can retain its historical name and corrected price.
  const corrected = priceOrder(correctedRequest, [], original);
  assert.equal(corrected.total, 260);
  assert.equal(corrected.change, 40);
  const next = replaceOrderInLedger(twoOrders, original, corrected);
  assert.equal(next.Takoyaki_Sales, 1120.1);
  assert.deepEqual(JSON.parse(next.Product_Sales_JSON), { Retired: 3, Cheese: 3 });
  assert.deepEqual(JSON.parse(next.Custom_Sales_JSON), [
    { description: 'Barkada mix', amount: 230.1 },
    { description: 'Small mix × 2', amount: 200 },
  ]);
  assert.equal(next.Breakdown_Bill, 80);
  assert.equal(next.Staff_Expenses_JSON, baseline.Staff_Expenses_JSON);
  assert.deepEqual(replaceOrderInLedger(next, corrected, original), twoOrders);
  assert.throws(() => replaceOrderInLedger(baseline, original, corrected), /no longer match/);
  assert.throws(() => normalizeOrderEdit({ ...request(), revision: 0, editId: id }), /Reload/);
  assert.throws(
    () => normalizeOrderEdit({ ...request(), revision: 1, editId: 'bad-id' }),
    /correction reference/,
  );
  assert.throws(
    () =>
      priceOrder(
        { ...correctedRequest, items: [{ kind: 'menu', name: 'Missing', quantity: 1, unitPrice: 10 }] },
        [],
        original,
      ),
    /no longer available/,
  );
});
