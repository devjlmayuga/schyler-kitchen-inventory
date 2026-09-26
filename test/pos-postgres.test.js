import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const databaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();

test(
  'POS saves order and sales atomically, deduplicates retries, preserves receipts and protects totals',
  { skip: !databaseUrl },
  async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.SI_API_TOKEN ||= 'pos-test-token';
    const { dispatchAction } = await import('../src/server/si/_router.js');
    const { withTransaction, dbClient, closePool } = await import('../src/server/si/postgres/client.js');
    const call = (action, payload = {}) =>
      dispatchAction({ action, payload, token: process.env.SI_API_TOKEN });
    const rollback = new Error('Intentional POS test rollback');
    const suffix = crypto.randomUUID();
    const name = `POS test ${suffix}`;
    const date = '2099-05-17';
    const input = {
      id: crypto.randomUUID(),
      date,
      type: 'Takeaway',
      customer: 'Table 2',
      notes: 'No spicy sauce',
      cashReceived: 500,
      items: [
        { kind: 'menu', name, quantity: 2, unitPrice: 65 },
        { kind: 'custom', name: 'Barkada mix', quantity: 1, unitPrice: 230 },
      ],
    };
    try {
      await withTransaction('test.pos.rollback', async () => {
        assert.equal(
          (await dbClient().query('select 1 from schyler_kitchen.pos_orders where business_date=$1', [date]))
            .rowCount,
          0,
          'fixture date must have no real POS orders',
        );
        await call('products.upsertMany', { items: [{ Name: name, Price: 65, Active: 'Y' }] });
        await call('salesFinance.upsertByDate', {
          date,
          row: {
            Takoyaki_Sales: 1000,
            Product_Sales_JSON: '{"Old item":3}',
            Staff_Expenses_JSON: '{"Legacy staff":100}',
            Custom_Expenses_JSON: '[{"description":"Delivery","amount":80}]',
            Previous_Cash_Added: 50,
          },
        });
        const stale = (await call('salesFinance.getByDate', { date })).row;
        const first = await call('pos.complete', input);
        assert.equal(first.order.total, 360);
        assert.equal(first.summary.count, 1);
        assert.equal(first.order.change, 140);
        assert.equal(first.sales.Takoyaki_Sales, 1360);
        assert.equal(first.sales.Remaining_Balance, 1230);
        assert.equal(first.order.customer, 'Table 2');
        assert.equal(first.order.notes, 'No spicy sauce');
        const second = await call('pos.complete', input);
        assert.equal(second.repeated, true);
        assert.equal(second.summary.count, 1);
        assert.equal(second.order.number, first.order.number);
        assert.equal(second.sales.Takoyaki_Sales, 1360);
        await assert.rejects(
          call('pos.complete', { ...input, notes: 'Different order' }),
          /already been used/,
        );
        const third = await call('pos.complete', { ...input, id: crypto.randomUUID() });
        assert.equal(third.sales.Takoyaki_Sales, 1720);
        assert.notEqual(third.order.number, first.order.number);
        const bootstrap = await call('pos.bootstrap', { date });
        assert.equal(bootstrap.summary.count, 2);
        assert.equal(bootstrap.summary.total, 720);
        assert.equal(bootstrap.orders.length, 2);
        assert.equal((await call('pos.orders', { date })).orders[0].number, third.order.number);
        await assert.rejects(
          call('salesFinance.upsertByDate', { date, row: stale }),
          /changed on another screen/,
        );
        const fresh = (await call('salesFinance.getByDate', { date })).row;
        await call('salesFinance.upsertByDate', {
          date,
          row: { ...fresh, Custom_Expenses_JSON: '[{"description":"Delivery","amount":100}]' },
        });
        const expenses = (await call('salesFinance.getByDate', { date })).row;
        assert.equal(expenses.Takoyaki_Sales, 1720);
        assert.equal(expenses.Expenses_Total, 200);
        assert.equal(expenses.Remaining_Balance, 1570);
        await assert.rejects(
          call('salesFinance.upsertByDate', { date, row: { ...expenses, Takoyaki_Sales: 1 } }),
          /cannot be overwritten/,
        );
        await assert.rejects(call('salesFinance.deleteByDate', { date }), /cannot be deleted/);
        await call('products.upsertMany', { items: [{ Name: name, Price: 90, Active: 'Y' }] });
        await assert.rejects(
          call('pos.complete', { ...input, id: crypto.randomUUID() }),
          /price has changed/,
        );
        assert.equal((await call('pos.orders', { date })).orders[0].items[0].unitPrice, 65);
        assert.equal(
          (await call('pos.complete', input)).order.total,
          360,
          'retry retains original price after catalog update',
        );
        assert.equal((await call('salesFinance.getByDate', { date })).row.Takoyaki_Sales, 1720);
        const edit = {
          ...input,
          revision: 1,
          editId: crypto.randomUUID(),
          reason: 'Quantity and mix amount corrected',
          items: [
            { kind: 'menu', name, quantity: 1, unitPrice: 60 },
            { kind: 'custom', name: 'Small mix', quantity: 2, unitPrice: 100 },
          ],
        };
        const corrected = await call('pos.edit', edit);
        assert.equal(corrected.order.id, first.order.id);
        assert.equal(corrected.order.number, first.order.number);
        assert.equal(corrected.order.revision, 2);
        assert.equal(corrected.order.total, 260);
        assert.equal(corrected.order.change, 240);
        assert.equal(corrected.sales.Takoyaki_Sales, 1620);
        assert.equal(corrected.sales.Expenses_Total, 200);
        assert.equal(corrected.sales.Remaining_Balance, 1470);
        assert.equal(corrected.summary.count, 2);
        assert.deepEqual(JSON.parse(corrected.sales.Product_Sales_JSON), { 'Old item': 3, [name]: 3 });
        assert.deepEqual(JSON.parse(corrected.sales.Custom_Sales_JSON), [
          { description: 'Barkada mix', amount: 230 },
          { description: 'Small mix × 2', amount: 200 },
        ]);
        assert.equal((await call('pos.order', { id: input.id })).order.revision, 2);
        const replay = await call('pos.edit', edit);
        assert.equal(replay.repeated, true);
        assert.equal(replay.order.revision, 2);
        assert.equal(replay.sales.Takoyaki_Sales, 1620);
        await assert.rejects(
          call('pos.edit', { ...edit, editId: crypto.randomUUID() }),
          /edited on another screen/,
        );
        await assert.rejects(
          call('pos.edit', { ...edit, notes: 'Reused reference' }),
          /reference was already used/,
        );
        await assert.rejects(call('pos.edit', { ...edit, date: '2099-05-18' }), /date cannot be changed/);
        await assert.rejects(
          call('pos.edit', { ...edit, revision: 2, editId: crypto.randomUUID(), cashReceived: 1 }),
          /cover the order/,
        );
        assert.equal((await call('pos.order', { id: input.id })).order.revision, 2);
        const audit = await dbClient().query(
          'select * from schyler_kitchen.pos_order_edits where order_id=$1',
          [input.id],
        );
        assert.equal(audit.rowCount, 1);
        assert.equal(audit.rows[0].before_details.total, 360);
        assert.equal(audit.rows[0].after_details.total, 260);
        assert.equal(audit.rows[0].reason, edit.reason);
        // A retry of the original checkout cannot undo the correction or create a sale.
        assert.equal((await call('pos.complete', input)).order.total, 260);
        // Expense editors opened before the correction must reload, preserving corrected revenue.
        await assert.rejects(
          call('salesFinance.upsertByDate', { date, row: expenses }),
          /changed on another screen/,
        );
        // Correcting back restores only this order, without repricing from today's catalog.
        const restored = await call('pos.edit', {
          ...input,
          revision: 2,
          editId: crypto.randomUUID(),
          reason: 'Restore original',
        });
        assert.equal(restored.sales.Takoyaki_Sales, 1720);
        assert.equal(restored.order.revision, 3);
        assert.equal(restored.summary.count, 2);
        assert.equal((await call('products.list')).items.find((item) => item.Name === name).Price, 90);
        // Exercise >30 orders and cursor pagination without touching the daily ledger.
        await dbClient().query(
          `insert into schyler_kitchen.pos_orders(id,business_date,created_by,request_hash,details,total)
        select gen_random_uuid(),$1::date,'test','test',$2::jsonb,0 from generate_series(1,31)`,
          [date, JSON.stringify({ ...first.order, total: 0 })],
        );
        const page = await call('pos.orders', { date });
        assert.equal(page.orders.length, 30);
        assert.ok(page.nextCursor);
        const next = await call('pos.orders', { date, before: page.nextCursor });
        assert.equal(next.orders.length, 3);
        assert.equal(next.nextCursor, null);
        assert.ok(next.orders.every((order) => !page.orders.some((previous) => previous.id === order.id)));
        throw rollback;
      });
      assert.fail('Tests must roll back');
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await closePool();
    }
  },
);
