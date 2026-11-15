# Migration history and workflow

## Legacy SQL drafts

The SQL files in this directory are preserved as historical design references. They contain earlier table names and assumptions and are **not** part of the active migration path. Do not run them.

The former design mixed account identity with business roles and used overlapping branch, booking, billing, and package tables. The updated design separates shared accounts, customer profiles, salon organizations and branches, salon memberships, branch-scoped role assignments, and domain-specific operational tables.

## Canonical schema

- Prisma models: `salonix-backend/prisma/models/`
- Prisma entry schema: `salonix-backend/prisma/schema.prisma`
- Ordered SQL migrations: `salonix-backend/prisma/migrations/`
- Prisma configuration: `salonix-backend/prisma.config.ts`

Each migration covers a bounded domain: identity, salon tenancy, services and staff, bookings and queue, packages and loyalty, inventory, POS, platform billing, customer engagement, or audit controls. This is intended to make the history easier to understand, review, and extend than one large schema file.

`src/generated/prisma/` contains generated Prisma Client code. It is build output from the canonical schema, not a second schema or migration source.

The Fastify server uses Prisma Client and a shared PostgreSQL pool. Repositories may use Prisma model operations or parameterized SQL for PostgreSQL-specific work. The direct PostgreSQL connection in `DATABASE_URL` is used at runtime and by Prisma migrations.

## Local checks and database application

Run from `salonix-backend/`:

```powershell
pnpm db:validate
pnpm db:generate
```

`pnpm db:migrate` is the database-applying command. Prisma migration configuration reads the direct connection string from `DATABASE_URL`. Do not run this command as a local validation step.

## Current status

Prisma schema validation and client generation have passed locally. All 21 canonical migrations were successfully applied to the confirmed empty development database on 2026-10-26.

The migration history documents an earlier deployment correction for the `queue_entry_services` composite key.

The auth migrations make account email optional, keep phone globally unique, constrain phone values to E.164, permit the `DEACTIVATED` account state, and make new accounts `PENDING` by default. Existing verification timestamps remain the source of truth for verified phone/email login.

Future migration runs must use the direct `DATABASE_URL` connection and verify the intended database before applying changes.

Keep the legacy drafts until a separately approved archival/removal decision is made.
