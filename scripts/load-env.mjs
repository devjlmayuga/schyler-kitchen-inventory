import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
  const localFile = path.resolve('.env.local');
  const defaultFile = path.resolve('.env');
  const envFile = fs.existsSync(localFile) ? localFile : defaultFile;
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
}
