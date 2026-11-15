# Salonix

Salonix is a salon management platform with a Next.js frontend and a modular TypeScript backend.

## Project structure

- `salonix-frontend/`: frontend application.
- `salonix-backend/`: API, domain modules, Prisma schema, and database migrations.
- `docker/`: local infrastructure configuration.
- `MODULES.md`: current module status and database design history.
- `AGENTS.md`: required repository workflow and safety rules.

## Backend development

From `salonix-backend/`:

```powershell
pnpm install
pnpm dev
```

The API runs on Fastify 5. Copy `.env.example` to `.env`, set a valid `DATABASE_URL` and a strong `JWT_SECRET` (at least 32 characters), then start the backend. CORS origins are configured through `CORS_ORIGINS`.

Run `pnpm typecheck` and `pnpm lint` to validate all backend source files.

## Database workflow

- Prisma schema source: `salonix-backend/prisma/`.
- Canonical migrations: `salonix-backend/prisma/migrations/`.
- Legacy SQL drafts under `salonix-backend/src/database/migrations/` are preserved for reference and are not run by the active migration path.
- Generated Prisma Client under `salonix-backend/src/generated/prisma/` is build output, not a second schema or a migration folder.
- `pnpm db:validate` and `pnpm db:generate` perform local schema checks and client generation.
- `pnpm db:migrate` applies migrations to the configured database. It is intentionally not part of routine local validation.

The runtime shares one PostgreSQL connection pool between Prisma Client and repositories that need parameterized PostgreSQL SQL. Keep persistence behind module repositories so the ORM/query style can evolve without coupling controllers or services to it.

## Database design update

The old drafts mixed identity, salon roles, branches, billing, and customer features across conflicting table names. The new design separates shared accounts, customer profiles, salon organizations and branches, staff memberships, scoped roles, operations, and platform billing into ordered domain migrations.

This improves tenant isolation, allows one person to have multiple roles or contexts, and makes each migration easier to understand and review. The canonical chain was applied to the configured Neon `neondb` on 2026-10-25 after a rollback-only SQL dry run; the target had no existing application tables or account rows.

The Fastify backend now uses phone-first signup with WhatsApp OTP, verified phone/email login, password reset, Redis-backed rate limits, and revocable sessions. Salon-offerings APIs are also mounted for package/combo catalogs, purchase requests, POS settlement handoff, entitlements, and usage ledger history. POS checkout/payment integration and external offer-notification delivery remain incomplete. Production messaging credentials and a reachable Redis service still need environment configuration.

Platform administration APIs are mounted for super-admin salon and account oversight, audited profile change approvals, B2B plan/add-on/entitlement controls, and supported platform settings. No admin frontend is included.

See [the module registry](MODULES.md) and [the backend migration guide](salonix-backend/src/database/migrations/README.md).
