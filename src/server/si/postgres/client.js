import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const transactions = new AsyncLocalStorage();
let pool;
let schemaVerified = false;

export function getPool() {
  if (!pool) {
    const connectionString = String(process.env.DATABASE_URL || '').trim();
    if (!connectionString) throw new Error('PostgreSQL storage is unavailable: DATABASE_URL is missing');
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.SI_DB_POOL_MAX || 5),
    });
    pool.on('error', () => {});
  }
  return pool;
}

export function dbClient() { return transactions.getStore() || getPool(); }

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  schemaVerified = false;
  await current.end();
}

export async function assertSchemaVersion(client = dbClient()) {
  if (schemaVerified) return;
  try {
    const result = await client.query('select max(version)::int version from schyler_kitchen.schema_versions');
    if (result.rows[0]?.version !== 2) throw new Error('Database schema version is incompatible');
    schemaVerified = true;
  } catch (error) {
    if (error.message === 'Database schema version is incompatible') throw error;
    throw new Error('Database schema is unavailable');
  }
}

export async function withTransaction(action, operation) {
  if (transactions.getStore()) return operation();
  const reads = new Set(['auth.me','auth.login','attendance.listWeek','face.profiles','face.eventsWeek','inventory.get','inventory.getOrSeed','inventory.seedTemplate','salesFinance.list','salesFinance.getByDate','needs.list','thresholds.get','items.list','products.list','salesConfig.get','sales.bootstrap','debug.auth']);
  if (reads.has(action)) {
    await assertSchemaVersion(getPool());
    return operation();
  }
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await assertSchemaVersion(client);
    const result = await transactions.run(client, operation);
    await client.query('insert into schyler_kitchen.application_write_log(action,entity_identity,after_payload) values($1,$1,$2)', [action, JSON.stringify({ accepted: true })]);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally { client.release(); }
}
