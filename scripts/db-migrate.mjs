import fs from 'node:fs';
import pg from 'pg';
import './load-env.mjs';

const connectionString = String(process.env.DATABASE_URL_UNPOOLED || '').trim();
if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is required');
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  console.log('Database schema version 1 applied.');
} finally { await client.end(); }
