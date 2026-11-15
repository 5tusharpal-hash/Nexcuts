# Salonix Module Registry

This registry describes the current backend state. A database table or Prisma model does not mean its feature is complete.

## Status legend

- **Partial**: Code or schema exists, but the feature is not fully validated and integrated.
- **Planned**: Design exists, implementation is still required.
- **Backlog**: Not designed or started.

## Backend modules

| Module | Status | Main responsibility | Current database area | Known gaps |
|---|---|---|---|---|
| `auth` | Partial | Typed phone-first identity, Google ID-token sign-in, contact verification, login, password recovery, and sessions | `accounts`, `customer_profiles`, `account_sessions`, `account_provider_identities` | Google client configuration and end-to-end provider/Redis tests remain |
| `admin` | Partial | Super-admin dashboard, salon/account directory, activity history, profile change approvals, B2B plan and entitlement controls, and supported platform settings | Existing tenancy, account, audit, and platform billing tables; `salon_profile_change_requests` | Admin UI is intentionally excluded; production integration and authorization tests remain |
| `tenancy` | Partial | Salon applications, owner membership, operating hours, service proposals, and platform review | `salon_organizations`, `salons`, `salon_applications`, `salon_business_hours`, `salon_memberships`, `salon_membership_locations`, `salon_organization_owners` | Notifications, evidence uploads, and integration tests remain |
| `rbac` | Partial | Salon permissions and scoped roles | `salon_roles`, `salon_memberships`, `salon_membership_locations`, `salon_membership_roles` | Role lifecycle and authorization integration tests remain |
| `booking` | Partial | Customer appointments and staff assignment | `customer_bookings`, `customer_booking_services`, `customer_booking_staff` | Group booking flow and end-to-end scheduling tests remain |
| `queue` | Partial | Walk-in queue, ordering, and staff assignment | `queue_entries`, `queue_entry_services`, `queue_entry_staff` | Realtime updates and race/concurrency integration tests remain |
| `staff` | Partial | OTP-first account linking, staff membership, roles, skills, and availability | `accounts`, `salon_memberships`, `salon_staff_profiles`, `salon_staff_skills`, `salon_staff_availability` | Invitations, branch-aware schedules, and integration tests remain. The older `staffRoutes` plugin is unmounted. |
| `employee_management` | Partial | Attendance with lunch exclusion, explicit service-time intervals, branch holidays, leave requests/balances, approved tips, and manual tip-refund tracking | `salon_employee_shifts`, `salon_employee_lunch_breaks`, employee leave/service/tip/refund tables, `pos_tips` | Migration is applied; route, RBAC, concurrency, and ledger integration tests remain. Payroll, automatic payment processing, and tip payout are excluded. |
| `services` | Partial | Salon service catalog, categories, system image defaults, and platform image policy | `salon_service_categories`, `salon_services`, `salon_service_default_images`, `platform_service_image_settings` | Migration is applied; service and storage integration tests against a real database remain |
| `salon_gallery` | Partial | Paid public gallery, category management, plan quota, and audited admin overrides | `salon_gallery_categories`, `salon_gallery_images`, `platform_salon_entitlement_overrides` | Migration is applied; plan catalog must set `public_gallery_limit` for the paid feature |
| `inventory` | Partial | Separate retail and salon-use stock pools, explicit batch operations, issue requests, estimated service usage, and in-app alerts | `salon_products`, `salon_inventory_batches`, `salon_inventory_ledger`, `salon_service_consumables`, inventory issue and reminder tables | Migration review, focused integration tests, production scheduler configuration, and frontend remain |
| `salon_offerings` | Partial | Versioned package/combo catalogs, purchase requests, manual sales, POS settlement handoff, entitlements, redemption, and offer ledger | `salon_packages`, `salon_service_combos`, offer revisions, purchase requests, customer entitlements, and `salon_offer_ledger` | POS billing/payment APIs are not integrated; external notification dispatch and refunds/reversals remain |
| `customer_plans` | Partial | Legacy customer package subscription APIs | `customer_package_subscriptions`, `customer_package_service_balances` | Offer purchases and redemptions now use `salon_offerings`; legacy endpoints need consolidation and lifecycle tests |
| `loyalty` | Partial | Salon-specific points and rewards | `salon_loyalty_programs`, `customer_loyalty_ledger` | Expiry, idempotency, and full redemption tests remain |
| `pos_billing` | Partial | Customer bills, configurable category tax defaults, audited per-item tax overrides, payments, refunds, and separate staff tip requests | `pos_billing_sessions`, `pos_bills`, `pos_bill_items`, `salon_tax_rates`, `pos_payments`, `pos_credit_notes`, `pos_tips` | Payment-provider integration and end-to-end financial tests remain |
| `platform_billing` | Partial | Salon subscription invoices, Razorpay/Stripe checkout, verified webhooks, idempotent payment posting, and configurable India GST | `platform_plan_catalog`, `platform_subscriptions`, `platform_salon_invoices`, `platform_payments`, platform GST settings and webhook events | Proration, credit notes, add-on billing, provider dashboard setup, and database-backed financial tests remain |
| `customer_ledger` | Partial | Customer-owned paginated payment, service, refund, and loyalty timeline with customer-scoped bill details | POS tables and `customer_loyalty_ledger` | Package history and database ownership integration tests remain |
| `notifications` | Partial | Customer-owned notification history, read state, channel preferences, and in-app, Resend, and approved WhatsApp marketing delivery | `account_notifications`, `customer_notification_preferences`, `notification_templates` | General transactional notification dispatch and end-to-end provider tests remain |
| `marketing` | Partial | Salon campaigns with queue-entry consent, branch-scoped opt-out, channel preference filtering, delivery logs, and bounded retries | `salon_marketing_campaigns`, `salon_marketing_deliveries`, `salon_marketing_consents`, `platform_salon_addons` | Scheduled/background dispatch and database-backed provider tests remain |
| `discovery` | Partial | Public profile, gallery, and paginated name/city/service search restricted to approved active salons | `salon_public_profiles`, `salon_gallery_categories`, `salon_gallery_images` | Geo-distance filtering remains; live queue discovery is excluded |
| `enquiries` | Partial | Rate-limited public enquiry submission and salon-scoped staff list, status, and response APIs | `salon_enquiries`, `salon_enquiry_responses` | Automated external response delivery remains out of scope; conversion to booking is excluded |
| `reviews` | Partial | Customer salon and stylist reviews, public listing, private low-score feedback | `customer_salon_reviews`, `customer_staff_reviews` | Owner alerts, moderation, public aggregation, and provider-backed review prompts remain |
| `analytics` | Partial | Authenticated salon revenue, customer, and staff reporting, employee service utilization, and repeat-customer churn alerts | POS, review, membership, attendance, lunch, and service-work tables | Staff efficiency scoring and database integration coverage remain |

## Identity and tenant model

- `accounts` stores credentials and an explicit `account_type` (`CUSTOMER`, `SALON`, `PLATFORM`, or `ADMIN`). Contact values are unique within an account type, so a person can have separate typed account rows.
- Customer, salon, and platform relationships are stored in their respective profile and membership tables, not as a global account role.
- A `salon_organization` owns one or more `salons`, where each salon is a branch.
- `salon_memberships` connect accounts to organizations. `salon_membership_locations` grants branch access.
- `salon_membership_roles` grants one or more roles at an assigned branch. Organization owners receive organization-wide access through ownership, not a copied role on every branch.
- Platform staff, the single platform super-admin assignment, and salon employees use separate authorization tables.
- Salon application and approval state is separate from subscription and plan state. Pending or rejected applications do not receive effective salon permissions.
- No demo-only identity or authentication bypass is used. Free plans and complimentary modules should use the shared plan-entitlement and admin-grant mechanism.

## Database change history

| Before | Now | Benefit |
|---|---|---|
| Legacy SQL drafts used overlapping `users`, `roles`, `branches`, `bookings`, `bills`, and package concepts. | Identity, tenancy, operations, customer features, and platform billing have separate domain models and ordered migration files. | Easier review, ownership, and incremental changes. |
| A person and a salon role were coupled in several older designs. | `accounts` is separate from customer profiles, salon memberships, branch locations, and role assignments. | One account can be a customer, owner, and employee in distinct scopes. |
| Branch ownership and staff access were not consistently represented. | Organizations own branches; employee access is assigned to explicit branches; owner access is derived from organization ownership. | Stronger tenant boundaries and multi-branch access control. |
| POS, platform billing, inventory, loyalty, and notifications reused inconsistent names and data shapes. | Domain-specific tables and repositories use the new canonical names. | Fewer naming conflicts and better auditability. |
| The legacy custom migration runner could execute the old draft chain. | Prisma migrations under `salonix-backend/prisma/migrations/` are canonical; old SQL drafts remain preserved and disabled. | A single, explicit migration path without deleting historical material. |

## Migration status

All 21 canonical migrations were applied to the confirmed empty development database on 2026-10-26. See the migration guide for the current connection and deployment workflow.

The backend server, auth, tenancy, RBAC, OTP-first staff onboarding, service catalog, salon gallery, and salon-offerings endpoints use Fastify. Offer routes cover versioned catalog management, purchase requests, POS settlement handoff, redemptions, and ledger history. POS checkout/payment orchestration and external notification dispatch are still incomplete; other feature route plugins remain unmounted until their contracts, data access, and authorization are complete.

See [the backend roadmap](salonix-backend/docs/ROADMAP.md), [API guidelines](salonix-backend/docs/API_GUIDELINES.md), [OpenAPI contract](salonix-backend/docs/openapi.yaml), [the billing plan](salonix-backend/docs/billing/BILLING_PLAN.md), and [the migration guide](salonix-backend/src/database/migrations/README.md) for details.
