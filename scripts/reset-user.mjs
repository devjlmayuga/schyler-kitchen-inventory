import crypto from 'node:crypto';
import pg from 'pg';
import './load-env.mjs';

const [username, password, role = 'admin'] = process.argv.slice(2);
if (!username || !password) throw new Error('Usage: npm run db:reset-user -- <username> <password> [role]');
if (!['admin', 'staff'].includes(role)) throw new Error('Role must be admin or staff');

const connectionString = String(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '').trim();
if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required');

const salt = crypto.randomUUID().replaceAll('-', '');
const pepper = String(process.env.SI_AUTH_PEPPER || '').trim();
const passwordHash = crypto.createHash('sha256').update(`${salt}${password}${pepper}`, 'utf8').digest('hex');
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query(`insert into schyler_kitchen.users(username,password_hash,salt,role,active)
    values($1,$2,$3,$4,true)
    on conflict ((lower(trim(username)))) do update
    set password_hash=excluded.password_hash,salt=excluded.salt,role=excluded.role,active=true`,
  [username.trim(), passwordHash, salt, role]);
  console.log(`Reset database user: ${username.trim()} (${role})`);
} finally {
  await client.end();
}
