# Salonix Backend

## Runtime

- Fastify 5 is the only HTTP framework.
- Pino writes structured logs to `logs/YYYY-MM-DD.log`; terminal output is limited to warnings, errors, and essential lifecycle messages.
- Legacy auth endpoints are mounted under `/api/v1/auth`. Typed account auth is available under `/api/v2/auth`.
- Salon applications, owner status, staff onboarding, and current salon access are mounted under `/api/v1`. `/api/v1/organizations` remains available for its legacy request shape; new onboarding should use `/api/v1/salon-applications`.
- Service catalog, service categories, and salon gallery APIs are mounted under `/api/v1`; the OpenAPI contract is in `docs/openapi.yaml`.
- Role access and role management endpoints are mounted under `/api/v1` and require authentication plus `salon:manage_roles` where applicable.
- `/health` is a liveness check. `/ready` checks database connectivity.
- Other feature route plugins remain unmounted until their contracts and authorization are complete.

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to the PostgreSQL connection used by the backend. For Neon, use the pooled connection string.
3. Set `MIGRATION_DATABASE_URL` to the direct, non-pooled PostgreSQL connection used by Prisma migrations. Local development may use the same local URL for both values.
4. Set `JWT_SECRET` to a random secret of at least 32 characters.
5. Set `CORS_ORIGINS` to comma-separated frontend origins.
6. From the repository root, start local Redis with `docker compose -f docker/docker-compose.yml up -d`, or set `REDIS_URL` to a reachable Redis instance.
7. Run `pnpm install`, then `pnpm dev`.

## Staging deployment

The recommended staging topology is a Vercel-hosted frontend, a separate Render Docker web service for the Fastify API, Neon Postgres and Object Storage, and a Redis service reachable over the Redis TCP protocol. Do not deploy the Fastify API as a Vercel function: the API process also owns Socket.IO, BullMQ workers, and scheduled work.

### Frontend on Vercel

- Set the Vercel project root directory to `salonix-frontend`.
- Set `NEXT_PUBLIC_APP_URL` to the staging frontend URL.
- Set `NEXT_PUBLIC_API_URL` to the staging API URL ending in `/api/v1`.
- Set `NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS` to `15000` or another approved timeout.
- Build and deploy the frontend after setting these values because `NEXT_PUBLIC_*` values are included in the browser build.

### Backend on Render

- Create a Docker web service rooted at `salonix-backend`, using its `Dockerfile`.
- Set the service health-check path to `/ready`, and keep the initial staging service to one instance because the API process currently starts workers and schedulers.
- Configure the required environment variables in Render's secret environment settings. Do not put secret values in source control or the admin database:
  - `NODE_ENV=production`, `HOST=0.0.0.0`, and the Render-provided `PORT`.
  - `DATABASE_URL` with the Neon pooled connection string.
  - `MIGRATION_DATABASE_URL` with the Neon direct, non-pooled connection string.
  - `REDIS_URL` with a Redis TCP connection string supported by node-redis, ioredis, and BullMQ. An HTTP-only Redis REST endpoint is not sufficient.
  - `CORS_ORIGINS` with the exact staging frontend origin.
  - `APP_ENV=staging` while keeping `NODE_ENV=production`.
  - Random, independent values for `JWT_SECRET` and `AUTH_OTP_HASH_SECRET`, each at least 32 characters.
  - `AUTH_OTP_DELIVERY=mock` is allowed without WhatsApp or Resend credentials. OTPs remain hashed, expire normally, and are never included in staging API responses. To test OTP delivery end to end, use `AUTH_OTP_DELIVERY=providers` and configure the approved WhatsApp template and Resend sender credentials.
  - For image uploads, the Neon bucket name in `MEDIA_STORAGE_BUCKET` and that branch's S3 endpoint, region, access key, and secret key using the `AWS_*` variables. These credentials must belong to the staging Neon branch.
  - Confirm the Neon project is in a region that supports Neon Object Storage before provisioning the staging bucket.
  - Configure Google OAuth and payment provider secrets only if those integrations are enabled for staging.
- Keep `AUTH_COOKIE_DOMAIN` unset to use a host-only API cookie. Use frontend and API custom domains under the same site, such as `app.example.com` and `api.example.com`, and keep HTTPS enabled.

### Database migrations

Run `pnpm db:migrate` once for each release, before deploying API code that requires the new schema. The command fails unless `MIGRATION_DATABASE_URL` is set and uses the direct Neon connection. Do not run migrations automatically every time an API instance starts, and never point a staging migration at the production branch.

Use a separate Neon branch for staging and configure its pooled and direct connection strings independently from production. Provision a private Object Storage bucket on that staging branch and pass its credentials to Render as secrets.

### Staging limitations

Render's free web service may sleep when idle. That is useful for a low-cost smoke-test environment, but API cold starts and sleeping background workers make it unsuitable for validating reliable scheduled jobs, realtime availability, or production response times. Use an always-on API and Redis plan for production-like staging. The current backend must remain at one instance until its embedded workers and schedulers are separated from the API process.

## Authentication

- Signup requires an international phone number with a `+` country code, such as `+91 98765 43210`. Valid numbers are normalized to E.164, which allows at most 15 digits; national-only, invalid, or overlong numbers are rejected.
- Every account has an `account_type`: `CUSTOMER`, `SALON`, `PLATFORM`, or `ADMIN`. Phone and email can be shared across account types, but are unique within each type.
- New accounts remain `PENDING` until phone verification. Account statuses are `PENDING`, `ACTIVE`, `SUSPENDED`, and `DEACTIVATED`.
- Google sign-in is available at `POST /api/v1/auth/google` for `CUSTOMER` and `SALON` accounts. Set `GOOGLE_CLIENT_ID`; new accounts must provide and verify a phone number before receiving a session. Existing accounts link only when the account type matches and the stored email is verified.
- Phone and email verification are tracked separately. Login requires an `ACTIVE` account and the exact phone or email used to log in must be verified.
- Passwords require at least 12 characters and are limited to 72 UTF-8 bytes for bcrypt compatibility.
- OTPs are six digits, expire after five minutes, are single-use, and are stored as keyed hashes in Redis. Resends have a 60-second cooldown; request and verification attempts are rate-limited by identifier and IP.
- Current limits are 5 OTP requests per identifier/hour and 10 per IP/hour, 10 OTP verification attempts per identifier/hour and 30 per IP/hour, plus 10 login attempts per identifier/15 minutes and 20 per IP/15 minutes.
- In development, `AUTH_OTP_DELIVERY=mock` avoids external messaging. The OTP is included in responses only in development when `AUTH_OTP_EXPOSE_OTP=true` (enabled by default in development). Verification is still required.
- `APP_ENV=staging` can use `AUTH_OTP_DELIVERY=mock`; OTPs are not exposed in responses, so completing OTP flows requires configuring delivery providers.
- Actual production (`APP_ENV=production`) requires `AUTH_OTP_DELIVERY=providers`, Redis, a separate OTP hash secret, Meta WhatsApp Cloud API credentials and an approved authentication template, plus Resend credentials and a verified sender address.
- Login and session checks reject every account state except `ACTIVE`. `PENDING`, `SUSPENDED`, and `DEACTIVATED` remain distinct lifecycle states; account administration endpoints are not part of this auth module.

Auth endpoints:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | Create a pending account and send phone verification OTP |
| POST | `/api/v1/auth/phone-verifications` | Request or resend phone verification OTP |
| POST | `/api/v1/auth/phone-verifications/confirm` | Verify phone and create an authenticated session |
| POST | `/api/v1/auth/login` | Sign in with a verified phone or email and password |
| POST | `/api/v1/auth/google` | Verify a Google ID token and sign in or start phone verification |
| PUT | `/api/v1/auth/me/email` | Add/change email and send verification OTP |
| PUT | `/api/v1/auth/me/phone` | Change phone, require verification, and revoke existing sessions |
| PUT | `/api/v1/auth/me/password` | Change password after checking the current password and revoke sessions |
| POST | `/api/v1/auth/email-verifications` | Resend the authenticated account's email OTP |
| POST | `/api/v1/auth/email-verifications/confirm` | Verify the authenticated account's email |
| POST | `/api/v1/auth/password-resets` | Request reset OTP using an already-verified phone or email |
| POST | `/api/v1/auth/password-resets/complete` | Verify OTP, set a new password, and revoke all sessions |
| GET | `/api/v1/auth/me` | Read the authenticated identity and verification status |
| POST | `/api/v1/auth/logout` | Revoke the current session |

The `/api/v2/auth` endpoints require `account_type` for registration, login, phone verification, and password resets. Public registration accepts `CUSTOMER` or `SALON`; `PLATFORM` and `ADMIN` accounts must be provisioned by platform operations. `/api/v1/auth` remains for existing clients and defaults registration and lookup to `CUSTOMER`.

For development signup, send `account_type`, `full_name`, `phone_number`, `password`, and optionally `email`. Use the returned `developmentOtp` with the phone verification confirmation endpoint. Once signed in, email can be added or verified using the endpoints above.

Example signup request:

```json
{
  "account_type": "SALON",
  "full_name": "Salon Owner",
  "phone_number": "+91 98765 43210",
  "password": "a long secure passphrase",
  "email": "owner@example.com"
}
```

## Database ownership

- `prisma/schema.prisma` and `prisma/models/` define the schema.
- `prisma/migrations/` is the canonical ordered migration chain.
- `src/generated/prisma/` is generated Prisma Client output.
- `src/database/migrations/` contains preserved historical SQL drafts. Do not execute them.

Available initial tenant endpoints:

- `POST /api/v1/salon-applications` creates an organization, its first pending salon branch, owner membership, application, weekly schedule, and optional service proposals in one transaction.
- `GET /api/v1/me/salon-applications` lists the owner's salon applications and review status.
- `PUT /api/v1/salon-applications/:salonId` updates and resubmits an application after changes are requested.
- `GET /api/v1/platform/salon-applications` lists applications for the singleton platform administrator, with `limit`, `offset`, and optional `status`.
- `PATCH /api/v1/platform/salon-applications/:salonId` approves, rejects, or requests changes. Rejection and change requests require a note.
- `GET /api/v1/me/salons` lists salon memberships, including their application status.
- `GET /api/v1/salons/:salonId/access/me` returns the authenticated account's effective roles and permissions.
- `POST /api/v1/salons/:salonId/staff-phone-verifications` requests phone OTP for an owner adding a staff account after salon approval.
- `POST /api/v1/salons/:salonId/staff-members` verifies OTP and creates a new `SALON` account or links an existing phone-verified `SALON` account to the salon.

Salon roles, staff profiles, and branch membership links are separate from account credentials. Unapproved salons have no effective salon permissions. Solo owners are added as stylists only when their application is approved. Optional services submitted with the application become active salon services on approval.

Plan selection, payments, subscriptions, and add-on pricing are not part of this salon application phase. The current product direction is one basic monthly salon plan with the discussed modules included at no extra charge. The public salon gallery remains a separately paid feature.

All 21 canonical migrations have been applied to the confirmed empty development database.

## Service catalog and media

- Salon service APIs support categories, name/description, decimal-string price, duration, target audience, public visibility, active state, and one optional image. Service images are capped at 2 MiB.
- Platform super-admins control whether service images are required and manage reusable category defaults. Salon custom images and system default images are separate choices.
- Salon gallery is a paid entitlement, separate from service images. Plans use the integer `public_gallery_limit`; the intended base quota is 20 active images across the salon. Platform super-admin overrides require a reason, can expire, and are audited.
- Gallery images are capped at 5 MiB each. Archived images no longer count toward the public quota.
- Image storage uses a private S3-compatible provider. Set `MEDIA_STORAGE_BUCKET`; Neon Object Storage `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` are used automatically. Optional `MEDIA_STORAGE_*` values override Neon values and support Cloudflare R2. Do not commit credentials.
- Uploaded JPEG, PNG, and WebP images are decoded and normalized to WebP. APIs persist object keys and return 15-minute signed read URLs.
- Clearing or archiving an image removes or disables its database association, not the stored object. A failed database write after upload may leave an unreferenced object; define an approved retention and reconciliation process before production cleanup.
- No media bucket is provisioned; configure storage credentials before enabling image uploads.

See [API guidelines](./docs/API_GUIDELINES.md) and the [OpenAPI contract](./docs/openapi.yaml) for route contracts, naming, permissions, and multipart request examples.

Run `pnpm db:validate`, `pnpm db:generate`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` for local checks. `pnpm db:migrate` changes the configured database and must only be run after reviewing the migration plan and obtaining approval.

Repositories own data access. Prisma is used for standard model operations; parameterized PostgreSQL SQL remains available for operations that need database-specific locking or query behavior. Both use the shared connection pool.
