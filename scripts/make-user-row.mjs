import crypto from 'node:crypto';

function hashPassword(password, salt) {
  const pepper = String(process.env.SI_AUTH_PEPPER || '').trim();
  const input = `${String(salt || '')}${String(password || '')}${pepper}`;
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

const [username, password, role = 'admin', active = 'Y'] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: node scripts/make-user-row.mjs <username> <password> [role] [active]');
  process.exit(1);
}

const salt = crypto.randomUUID().replaceAll('-', '');
const Password_Hash = hashPassword(password, salt);

console.log(
  JSON.stringify(
    {
      Username: username,
      Password_Hash,
      Salt: salt,
      Role: role,
      Active: active,
    },
    null,
    2,
  ),
);

