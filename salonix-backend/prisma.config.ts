import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const migrationDatabaseUrl =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!migrationDatabaseUrl) {
  throw new Error('Set MIGRATION_DATABASE_URL or DATABASE_URL for Prisma commands');
}

export default defineConfig({
  schema: 'prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: migrationDatabaseUrl,
  },
});
