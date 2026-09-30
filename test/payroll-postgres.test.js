import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const databaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
test(
  'payroll, custom ledger entries and renames persist atomically in PostgreSQL',
  { skip: !databaseUrl },
  async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.SI_API_TOKEN ||= 'rollback-only-test-token';
    process.env.SI_JWT_SECRET ||= 'rollback-only-test-jwt-secret';
    const { dispatchAction } = await import('../src/server/si/_router.js');
    const { withTransaction, closePool, dbClient } = await import('../src/server/si/postgres/client.js');
    const suffix = crypto.randomUUID();
    const staff = `Payroll test ${suffix}`;
    const item = `Stock test ${suffix}`;
    const product = `Menu test ${suffix}`;
    const date = '2099-03-10';
    const weekStart = '2099-03-08';
    const rollback = new Error('Intentional test rollback');
    const call = (action, payload = {}) =>
      dispatchAction({ action, payload, token: process.env.SI_API_TOKEN });
    try {
      await withTransaction('test.payroll.rollback', async () => {
        const { config } = await call('salesConfig.get');
        await call('salesConfig.save', {
          config: {
            ...config,
            staff: [staff],
            payroll: {
              quotaTarget: 4000,
              staffRates: { [staff]: { dailyRate: 400, quotaBonus: 50, otRate: 50 } },
            },
          },
        });
        assert.equal((await call('salesConfig.get')).config.payroll.staffRates[staff].dailyRate, 400);
        assert.equal(Object.hasOwn((await call('sales.bootstrap', { date })).config, 'payroll'), false);
        await call('salesFinance.upsertByDate', {
          date,
          row: {
            Takoyaki_Sales: 4230,
            Product_Sales_JSON: JSON.stringify({ [product]: 2 }),
            Custom_Sales_JSON: '[{"description":"Barkada mix","amount":230}]',
            Custom_Expenses_JSON: '[{"description":"Delivery","amount":80.50}]',
            Staff_Expenses_JSON: JSON.stringify({ [staff]: 100 }),
          },
        });
        const ledger = (await call('salesFinance.getByDate', { date })).row;
        assert.equal(ledger.Takoyaki_Sales, 4230);
        assert.equal(ledger.Expenses_Total, 180.5);
        assert.equal(ledger.Remaining_Balance, 4049.5);
        assert.equal(JSON.parse(ledger.Custom_Sales_JSON)[0].description, 'Barkada mix');
        assert.equal(JSON.parse(ledger.Custom_Expenses_JSON)[0].amount, 80.5);
        assert.equal(
          (await call('salesFinance.list', { from: date, to: date })).rows[0].Expenses_Total,
          180.5,
        );
        const attendance = await call('attendance.listWeek', { weekStart });
        assert.equal(attendance.salesByDate[date], 4230);
        assert.ok(
          attendance.records.some(
            (record) => record.staff === staff && record.date === date && record.onDuty,
          ),
        );
        const saved = await call('attendance.saveWeek', {
          weekStart,
          records: [{ staff, date, scheduled: true, onDuty: true, overtimeHours: 1.5 }],
        });
        assert.equal(saved.records[0].scheduled, true);
        assert.equal(saved.records[0].rates.dailyRate, 400);
        let reloaded = await call('attendance.listWeek', { weekStart });
        assert.equal(
          reloaded.records.find((record) => record.staff === staff && record.date === date).overtimeHours,
          1.5,
        );
        await call('attendance.saveWeek', {
          weekStart,
          records: [{ ...saved.records[0], onDuty: false, overtimeHours: 0 }],
        });
        reloaded = await call('attendance.listWeek', { weekStart });
        assert.equal(
          reloaded.records.find((record) => record.staff === staff && record.date === date).onDuty,
          false,
          'manual off-duty overrides sales',
        );
        await call('salesConfig.save', {
          config: {
            ...config,
            staff: [staff],
            payroll: { staffRates: { [staff]: { dailyRate: 900, quotaBonus: 100, otRate: 100 } } },
          },
        });
        assert.equal(
          (await call('attendance.listWeek', { weekStart })).records.find(
            (record) => record.staff === staff && record.date === date,
          ).rates.dailyRate,
          400,
        );
        await call('items.upsertMany', { items: [{ Product: item, Unit: 'kg', Threshold_Limit: 2 }] });
        const identity = await dbClient().query(
          'select id from schyler_kitchen.inventory_items where product=$1',
          [item],
        );
        await call('inventory.submit', {
          date,
          items: [
            {
              Product: item,
              Current_Qty: 3,
              In_Stock: 0,
              Out_Stock: 1,
              Closing_Qty: 2,
              Unit: 'kg',
              Threshold_Limit: 2,
            },
          ],
        });
        await call('needs.manual.upsert', { date, item: { Product: item, Current_Closing_Qty: 2 } });
        await call('items.upsertMany', {
          items: [{ Product: `${item} renamed`, Original_Name: item, Unit: 'kg', Threshold_Limit: 2 }],
        });
        const renamed = await dbClient().query(
          'select id from schyler_kitchen.inventory_items where product=$1',
          [`${item} renamed`],
        );
        assert.equal(renamed.rows[0].id, identity.rows[0].id);
        assert.equal((await call('inventory.get', { date })).items[0].Product, `${item} renamed`);
        assert.ok(
          (await call('needs.list', { date, source: 'all' })).items.some(
            (entry) => entry.Product === `${item} renamed`,
          ),
        );
        await call('products.upsertMany', { items: [{ Name: product, Price: 230 }] });
        await call('products.upsertMany', {
          items: [{ Name: `${product} renamed`, Original_Name: product, Price: 240 }],
        });
        const menu = (await call('products.list')).items;
        assert.ok(menu.some((entry) => entry.Name === `${product} renamed`));
        assert.ok(!menu.some((entry) => entry.Name === product));
        assert.equal(
          JSON.parse((await call('salesFinance.getByDate', { date })).row.Product_Sales_JSON)[product],
          2,
          'historical sold names remain unchanged',
        );
        await assert.rejects(
          call('products.upsertMany', {
            items: [{ Name: `${product} collision`, Original_Name: 'does-not-exist', Price: 1 }],
          }),
          /Reload/,
        );
        const username = `test-${suffix}`;
        await call('auth.admin.upsertUser', { username, password: suffix, role: 'staff', active: 'Y' });
        const login = await call('auth.login', { username, password: suffix });
        const staffCall = (action, payload = {}) =>
          dispatchAction({ action, payload, session: login.sessionToken });
        assert.equal(Object.hasOwn((await staffCall('salesConfig.get')).config, 'payroll'), false);
        await assert.rejects(staffCall('salesConfig.save', { config }), /admin only/);
        await assert.rejects(staffCall('attendance.listWeek', { weekStart }), /admin only/);
        throw rollback;
      });
      assert.fail('The integration transaction must always roll back');
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await closePool();
    }
  },
);
