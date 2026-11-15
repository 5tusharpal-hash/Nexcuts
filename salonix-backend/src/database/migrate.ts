import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationDatabaseUrl) {
  throw new Error('MIGRATION_DATABASE_URL is required to deploy database migrations');
}

const prismaCliPath = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(
  process.execPath,
  [prismaCliPath, 'migrate', 'deploy'],
  {
    env: {
      ...process.env,
      MIGRATION_DATABASE_URL: migrationDatabaseUrl,
    },
    stdio: 'inherit',
  }
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
