import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const databaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();

test('existing business actions run through PostgreSQL', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SI_API_TOKEN = 'local-test-token';
  process.env.SI_JWT_SECRET = 'local-test-jwt-secret';
  process.env.FACE_DESCRIPTOR_KEY = 'local-test-face-descriptor-key-32-characters';
  const { dispatchAction } = await import('../src/server/si/_router.js');
  const { closePool } = await import('../src/server/si/postgres/client.js');
  const covered = new Set();
  const call = (action, payload = {}) => {
    covered.add(action);
    return dispatchAction({ action, payload, token: 'local-test-token' });
  };

  await call('auth.admin.upsertUser', { username: 'api-test-admin', password: 'test-password', role: 'admin', active: 'Y' });
  const login = await call('auth.login', { username: 'api-test-admin', password: 'test-password' });
  assert.equal(login.user.role, 'admin');
  assert.equal((await call('auth.me')).user.role, 'admin');
  assert.equal((await call('debug.auth')).storageBackend, 'postgres');
  assert.equal((await call('auth.admin.upsertUser', { username: 'api-test-user', password: 'test-password', role: 'staff', active: 'Y' })).username, 'api-test-user');

  const items = await call('items.list');
  assert.ok(items.items.length > 0, 'inventory catalog should not be empty');
  const thresholdItems = await call('thresholds.get');
  assert.equal(thresholdItems.items.length, items.items.length, 'thresholds list should match inventory catalog size');
  await call('thresholds.update', { product: items.items[0].Product, threshold: items.items[0].Threshold_Limit });
  await call('items.upsert', { item: { Product: 'API Test Item', Unit: 'pcs', Threshold_Limit: 2 } });
  const itemBatch = await call('items.upsertMany', { items: [
    { Product: 'API Test Item', Unit: 'packs', Threshold_Limit: 3 },
    { Product: 'API Test Item 2', Unit: 'pcs', Threshold_Limit: 1 },
  ] });
  assert.equal(itemBatch.total, 2);
  assert.equal((await call('items.delete', { product: 'API Test Item' })).deleted.inventory, 1);
  assert.equal((await call('items.delete', { product: 'API Test Item 2' })).deleted.inventory, 1);

  const products = await call('products.list');
  assert.ok(products.items.length > 0);
  await call('products.upsert', { item: { Category: 'Test', Name: 'API Test Product', Price: 10, Active: 'Y' } });
  const productBatch = await call('products.upsertMany', { items: [
    { Category: 'Test 2', Name: 'API Test Product', Price: 11, Active: 'Y' },
    { Category: 'Test', Name: 'API Test Product 2', Price: 12, Active: 'Y' },
  ] });
  assert.equal(productBatch.total, 2);
  assert.equal((await call('products.delete', { name: 'API Test Product' })).deleted, 1);
  assert.equal((await call('products.delete', { name: 'API Test Product 2' })).deleted, 1);

  const salesConfig = await call('salesConfig.get');
  assert.ok(Array.isArray(salesConfig.config.staff) && salesConfig.config.staff.length >= 2, 'sales config should include staffed payroll entries');
  assert.ok(salesConfig.config.staff.includes('Nathalie'));
  assert.ok(salesConfig.config.staff.includes('Mykah'));
  assert.equal(Object.hasOwn(salesConfig.config, 'config'), false, 'legacy nested config must not leak to clients');
  await call('salesConfig.save', { config: salesConfig.config });

  const template = await call('inventory.seedTemplate', { date: '2099-01-02' });
  assert.ok(template.items.length > 0, 'inventory template should seed catalog rows');
  const seededInventory = await call('inventory.getOrSeed', { date: '2099-01-02' });
  assert.equal(seededInventory.seeded, true);
  assert.equal(seededInventory.items.length, template.items.length, 'seeded inventory should match seeded template size');

  const sample = items.items[0];
  await call('inventory.submit', { date: '2099-01-02', items: [{ ...sample, Current_Qty: 3, In_Stock: 2, Out_Stock: 1, Closing_Qty: 4 }] });
  const inventory = await call('inventory.get', { date: '2099-01-02' });
  assert.equal(inventory.items.length, 1);
  assert.equal(inventory.items[0].Closing_Qty, 4);
  const existingInventory = await call('inventory.getOrSeed', { date: '2099-01-02' });
  assert.equal(existingInventory.seeded, false);
  assert.equal(existingInventory.items.length, 1);
  assert.equal((await call('inventory.setClosed', { date: '2099-01-02', closed: true })).closed, true);
  assert.equal((await call('inventory.setClosed', { date: '2099-01-02', closed: false })).closed, false);
  assert.ok((await call('inventory.deleteDay', { date: '2099-01-02' })).deleted > 0);

  const bootstrap = await call('sales.bootstrap', { date: '2099-01-02' });
  assert.ok(bootstrap.products.length > 0, 'sales bootstrap should include available product catalog entries');
  const importedSale = await call('salesFinance.getByDate', { date: '2026-09-13' });
  assert.ok(importedSale.row.Product_Sales_JSON, 'imported sales details must be preserved');
  assert.equal(JSON.parse(importedSale.row.Product_Sales_JSON).Cheese, 6);
  await call('salesFinance.upsertByDate', { date: '2099-01-02', row: { Takoyaki_Sales: 100, Previous_Cash_Added: 10 } });
  const sales = await call('salesFinance.getByDate', { date: '2099-01-02' });
  assert.equal(sales.row.Final_Total_Cash, 110);
  const attendance = await call('attendance.listWeek', { weekStart: '2098-12-28' });
  assert.deepEqual(attendance.openDates, ['2099-01-02']);
  assert.ok(attendance.records.some((record) => record.date === '2099-01-02' && record.staff === 'Nathalie' && record.onDuty === true));
  assert.ok(attendance.records.some((record) => record.date === '2099-01-02' && record.staff === 'Mykah' && record.onDuty === true));
  assert.equal(attendance.derivedFrom, 'sales');
  assert.ok(attendance.records.some((record) => record.date === '2099-01-02' && record.staff === 'Nathalie' && record.onDuty === true));
  assert.ok(attendance.records.some((record) => record.date === '2099-01-02' && record.staff === 'Mykah' && record.onDuty === true));
  assert.equal((await call('salesFinance.list', { from: '2099-01-01', to: '2099-01-03' })).rows.length, 1);
  assert.equal((await call('salesFinance.deleteByDate', { date: '2099-01-02' })).deleted, 1);

  assert.equal((await call('needs.list', { date: '2099-01-02', source: 'all' })).items.length, 0);
  await call('needs.manual.upsert', { date: '2099-01-02', item: { Product: items.items[0].Product, Current_Closing_Qty: 2 } });
  assert.equal((await call('needs.list', { date: '2099-01-02', source: 'all' })).items.length, 1);
  await call('needs.manual.remove', { date: '2099-01-02', Product: items.items[0].Product });

  await call('attendance.saveWeek', { weekStart: '2098-12-28', records: [] });

  const faceDescriptor = Array.from({ length: 64 }, (_, index) => (index === 0 ? 1 : 0));
  assert.equal((await call('face.enroll', { staff: 'Nathalie', descriptor: faceDescriptor, consent: true })).enrolled, true);
  assert.equal((await call('face.profiles')).profiles.length, 1);
  assert.equal((await call('face.checkIn', { descriptor: faceDescriptor, deviceLabel: 'test-kiosk' })).staff, 'Nathalie');
  covered.add('face.clock');
  const publicClockOut = await dispatchAction({ action: 'face.clock', payload: { descriptor: faceDescriptor, eventType: 'CHECK_OUT', deviceLabel: 'public-kiosk' } });
  assert.equal(publicClockOut.recorded, true);
  const faceEvents = (await call('face.eventsWeek', { weekStart: new Date().toISOString().slice(0, 10) })).events;
  const thisStaffEvents = faceEvents.filter((event) => event.staff === 'Nathalie');
  assert.ok(thisStaffEvents.length >= 2, 'face attendance should record both check-in and check-out events');
  assert.ok(thisStaffEvents.some((event) => event.event_type === 'CHECK_IN'));
  assert.ok(thisStaffEvents.some((event) => event.event_type === 'CHECK_OUT'));
  assert.equal((await call('face.remove', { staff: 'Nathalie' })).deleted, 1);

  const routerSource = fs.readFileSync(new URL('../src/server/si/_router.js', import.meta.url), 'utf8');
  const actions = [...routerSource.matchAll(/case '([^']+)'/g)].map((match) => match[1]).filter((action) => !action.startsWith('pos.')); // POS actions have a separate rollback test.
  assert.deepEqual([...actions].sort(), [...covered].sort(), 'every API action must have integration coverage');
  await closePool();
});
