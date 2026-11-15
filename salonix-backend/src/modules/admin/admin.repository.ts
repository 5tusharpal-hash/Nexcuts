import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
  AdminAccountListQuery,
  AdminAccountStatus,
  AdminActionContext,
  AdminAddonUpdate,
  AdminEntitlementUpdate,
  AdminPagination,
  AdminPlanUpdate,
  SalonProfileChangeRequestInput,
  SalonProfileChangeReviewInput,
  AdminSalonListQuery,
  AdminStatusUpdate,
  AdminSubscriptionUpdate,
} from './admin.types.js';

interface AccountActionRow extends QueryResultRow {
  id: string;
  accountType: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  phoneNumber: string;
  phoneVerifiedAt: Date | null;
  status: AdminAccountStatus;
  isSuperAdmin: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

export class AdminRepository {
  async getDashboard() {
    const result = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM salon_applications WHERE status = 'PENDING') AS "pendingApplications",
         (SELECT COUNT(*)::int FROM salon_applications WHERE status = 'CHANGES_REQUESTED') AS "changesRequested",
         (SELECT COUNT(*)::int FROM salon_applications WHERE status = 'APPROVED') AS "approvedApplications",
         (SELECT COUNT(*)::int FROM salon_applications WHERE status = 'REJECTED') AS "rejectedApplications",
         (SELECT COUNT(*)::int FROM salons WHERE status = 'ACTIVE' AND deleted_at IS NULL) AS "activeSalons",
         (SELECT COUNT(*)::int FROM salons WHERE deleted_at IS NULL) AS "totalBranches",
         (SELECT COUNT(*)::int FROM salon_organizations WHERE deleted_at IS NULL) AS "totalOrganizations",
         (SELECT COUNT(*)::int FROM accounts WHERE status = 'ACTIVE' AND deleted_at IS NULL) AS "activeAccounts",
         (SELECT COUNT(*)::int FROM accounts WHERE status = 'SUSPENDED' AND deleted_at IS NULL) AS "suspendedAccounts",
         (SELECT COUNT(*)::int FROM platform_subscriptions WHERE status = 'ACTIVE') AS "activeSubscriptions",
         (SELECT COUNT(*)::int FROM platform_salon_invoices WHERE status IN ('UNPAID', 'PARTIAL')) AS "unpaidInvoices",
         (SELECT COUNT(*)::int FROM platform_salon_invoices WHERE status = 'PAID') AS "paidInvoices",
         (SELECT COALESCE(SUM(total_amount), 0)::text
          FROM platform_salon_invoices WHERE status IN ('UNPAID', 'PARTIAL')) AS "unpaidInvoiceAmount",
         (SELECT COALESCE(SUM(total_amount), 0)::text
          FROM platform_salon_invoices WHERE status = 'PAID') AS "paidInvoiceAmount"`
    );
    return result.rows[0];
  }

  async listSalons(query: AdminSalonListQuery) {
    const filterValues = [
      query.search ?? null,
      query.applicationStatus ?? null,
      query.salonStatus ?? null,
      query.city ?? null,
    ];
    const [result, count] = await Promise.all([db.query(
      `SELECT
         salon.id AS "salonId",
         organization.id AS "organizationId",
         organization.name AS "organizationName",
         salon.branch_code AS "branchCode",
         salon.name AS "salonName",
         salon.city,
         salon.status AS "salonStatus",
         COALESCE(application.status, 'NOT_SUBMITTED') AS "applicationStatus",
         application.submitted_at AS "submittedAt",
         owner.full_name AS "ownerName",
         owner.email AS "ownerEmail",
         owner.phone_number AS "ownerPhoneNumber",
         (SELECT COUNT(*)::int FROM salons AS branch
          WHERE branch.organization_id = organization.id AND branch.deleted_at IS NULL) AS "branchCount",
         billing.plan_name AS "planName",
         billing.monthly_price::text AS "planPrice",
         billing.subscription_status AS "subscriptionStatus",
         (SELECT COUNT(*)::int FROM platform_salon_invoices AS invoice
          WHERE invoice.salon_id = salon.id AND invoice.status IN ('UNPAID', 'PARTIAL')) AS "unpaidInvoiceCount"
       FROM salons AS salon
       JOIN salon_organizations AS organization ON organization.id = salon.organization_id
       LEFT JOIN salon_applications AS application ON application.salon_id = salon.id
       LEFT JOIN LATERAL (
         SELECT account.full_name, account.email, account.phone_number
         FROM salon_organization_owners AS salon_owner
         JOIN accounts AS account ON account.id = salon_owner.account_id
         WHERE salon_owner.organization_id = organization.id
         ORDER BY salon_owner.assigned_at
         LIMIT 1
       ) AS owner ON TRUE
       LEFT JOIN LATERAL (
         SELECT plan.name AS plan_name, plan.monthly_price,
                subscription.status AS subscription_status
         FROM platform_subscriptions AS subscription
         JOIN platform_plan_catalog AS plan ON plan.id = subscription.plan_id
         WHERE subscription.salon_id = salon.id
           AND subscription.status IN ('ACTIVE', 'PENDING_PAYMENT')
         ORDER BY subscription.created_at DESC
         LIMIT 1
       ) AS billing ON TRUE
       WHERE salon.deleted_at IS NULL
         AND organization.deleted_at IS NULL
         AND ($1::varchar IS NULL OR
              salon.name ILIKE '%' || $1 || '%' OR
              organization.name ILIKE '%' || $1 || '%' OR
              COALESCE(owner.full_name, '') ILIKE '%' || $1 || '%' OR
              COALESCE(owner.email, '') ILIKE '%' || $1 || '%' OR
              COALESCE(owner.phone_number, '') ILIKE '%' || $1 || '%')
         AND ($2::varchar IS NULL OR application.status = $2)
         AND ($3::varchar IS NULL OR salon.status = $3)
         AND ($4::varchar IS NULL OR salon.city ILIKE '%' || $4 || '%')
       ORDER BY application.submitted_at DESC NULLS LAST, organization.name, salon.name, salon.id
       LIMIT $5 OFFSET $6`,
      [
        ...filterValues,
        query.limit,
        query.offset,
      ]
    ), db.query(
      `SELECT COUNT(*)::int AS total
       FROM salons AS salon
       JOIN salon_organizations AS organization ON organization.id = salon.organization_id
       LEFT JOIN salon_applications AS application ON application.salon_id = salon.id
       LEFT JOIN LATERAL (
         SELECT account.full_name, account.email, account.phone_number
         FROM salon_organization_owners AS salon_owner
         JOIN accounts AS account ON account.id = salon_owner.account_id
         WHERE salon_owner.organization_id = organization.id
         ORDER BY salon_owner.assigned_at
         LIMIT 1
       ) AS owner ON TRUE
       WHERE salon.deleted_at IS NULL
         AND organization.deleted_at IS NULL
         AND ($1::varchar IS NULL OR
              salon.name ILIKE '%' || $1 || '%' OR
              organization.name ILIKE '%' || $1 || '%' OR
              COALESCE(owner.full_name, '') ILIKE '%' || $1 || '%' OR
              COALESCE(owner.email, '') ILIKE '%' || $1 || '%' OR
              COALESCE(owner.phone_number, '') ILIKE '%' || $1 || '%')
         AND ($2::varchar IS NULL OR application.status = $2)
         AND ($3::varchar IS NULL OR salon.status = $3)
         AND ($4::varchar IS NULL OR salon.city ILIKE '%' || $4 || '%')`,
      filterValues
    )]);
    return {
      items: result.rows,
      total: count.rows[0]?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getSalonDetails(salonId: string) {
    const salonResult = await db.query(
      `SELECT
         salon.id AS "salonId",
         salon.organization_id AS "organizationId",
         organization.name AS "organizationName",
         organization.legal_name AS "legalName",
         organization.status AS "organizationStatus",
         salon.branch_code AS "branchCode",
         salon.name AS "salonName",
         salon.address_line_1 AS "addressLine1",
         salon.address_line_2 AS "addressLine2",
         salon.city,
         salon.state,
         salon.postal_code AS "postalCode",
         salon.country_code AS "countryCode",
         salon.timezone,
         salon.status AS "salonStatus",
         application.id AS "applicationId",
         application.business_type AS "businessType",
         application.status AS "applicationStatus",
         application.proposed_services AS "proposedServices",
         application.review_notes AS "reviewNotes",
         application.submitted_at AS "submittedAt",
         application.reviewed_at AS "reviewedAt",
         owner.id AS "ownerAccountId",
         owner.full_name AS "ownerName",
         owner.email AS "ownerEmail",
         owner.phone_number AS "ownerPhoneNumber",
         owner.status AS "ownerAccountStatus"
       FROM salons AS salon
       JOIN salon_organizations AS organization ON organization.id = salon.organization_id
       LEFT JOIN salon_applications AS application ON application.salon_id = salon.id
       LEFT JOIN LATERAL (
         SELECT account.id, account.full_name, account.email, account.phone_number, account.status
         FROM salon_organization_owners AS salon_owner
         JOIN accounts AS account ON account.id = salon_owner.account_id
         WHERE salon_owner.organization_id = organization.id
         ORDER BY salon_owner.assigned_at
         LIMIT 1
       ) AS owner ON TRUE
       WHERE salon.id = $1 AND salon.deleted_at IS NULL AND organization.deleted_at IS NULL`,
      [salonId]
    );
    const salon = salonResult.rows[0];
    if (!salon) return null;

    const [branches, subscriptions, invoices, payments, financialLedger, addons, entitlements] = await Promise.all([
      db.query(
        `SELECT id AS "salonId", branch_code AS "branchCode", name AS "salonName",
                address_line_1 AS "addressLine1", address_line_2 AS "addressLine2",
                city, state, postal_code AS "postalCode", country_code AS "countryCode",
                status, created_at AS "createdAt"
         FROM salons
         WHERE organization_id = $1 AND deleted_at IS NULL
         ORDER BY name, id`,
        [salon.organizationId]
      ),
      db.query(
        `SELECT subscription.id, subscription.salon_id AS "salonId", plan.id AS "planId",
                plan.key AS "planKey", plan.name AS "planName",
                plan.monthly_price::text AS "monthlyPrice", subscription.status,
                subscription.billing_cycle_start AS "billingCycleStart",
                subscription.billing_cycle_end AS "billingCycleEnd"
         FROM platform_subscriptions AS subscription
         JOIN platform_plan_catalog AS plan ON plan.id = subscription.plan_id
         WHERE subscription.organization_id = $1
         ORDER BY subscription.created_at DESC`,
        [salon.organizationId]
      ),
      db.query(
        `SELECT id, salon_id AS "salonId", invoice_number AS "invoiceNumber",
                total_amount::text AS amount, status,
                billing_period_start AS "billingPeriodStart",
                billing_period_end AS "billingPeriodEnd",
                created_at AS "createdAt", paid_at AS "paidAt"
         FROM platform_salon_invoices
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [salon.organizationId]
      ),
      db.query(
        `SELECT payment.id, bill.id AS "consolidatedBillId",
                payment.amount::text AS amount, payment.payment_method AS "paymentMethod",
                payment.provider, payment.currency, payment.status,
                payment.created_at AS "createdAt", payment.completed_at AS "completedAt"
         FROM platform_payments AS payment
         JOIN platform_consolidated_bills AS bill
           ON bill.id = payment.consolidated_bill_id
         WHERE bill.organization_id = $1
         ORDER BY payment.created_at DESC
         LIMIT 100`,
        [salon.organizationId]
      ),
      db.query(
        `SELECT id, salon_id AS "salonId", transaction_type AS "transactionType",
                amount::text AS amount, reason, invoice_id AS "invoiceId",
                created_at AS "createdAt"
         FROM platform_financial_ledger
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [salon.organizationId]
      ),
      db.query(
        `SELECT salon_addon.salon_id AS "salonId", addon.id AS "addonId",
                addon.key, addon.name, addon.price::text AS price,
                salon_addon.status, salon_addon.activated_at AS "activatedAt",
                salon_addon.cancelled_at AS "cancelledAt"
         FROM platform_salon_addons AS salon_addon
         JOIN platform_addons AS addon ON addon.id = salon_addon.addon_id
         JOIN salons AS branch ON branch.id = salon_addon.salon_id
         WHERE branch.organization_id = $1
         ORDER BY addon.name, salon_addon.activated_at DESC`,
        [salon.organizationId]
      ),
      db.query(
        `SELECT override.salon_id AS "salonId", override.feature_key AS "featureKey",
                override.feature_value AS "featureValue", override.reason,
                override.expires_at AS "expiresAt", override.created_at AS "createdAt",
                override.updated_at AS "updatedAt", override.granted_by_account_id AS "grantedByAccountId"
         FROM platform_salon_entitlement_overrides AS override
         JOIN salons AS branch ON branch.id = override.salon_id
         WHERE branch.organization_id = $1
         ORDER BY override.updated_at DESC`,
        [salon.organizationId]
      ),
    ]);

    return {
      ...salon,
      branches: branches.rows,
      subscriptions: subscriptions.rows,
      invoices: invoices.rows,
      payments: payments.rows,
      financialLedger: financialLedger.rows,
      addons: addons.rows,
      entitlements: entitlements.rows,
    };
  }

  async listSalonActivity(
    salonId: string,
    query: AdminPagination & { resourceType?: string }
  ) {
    const salon = await db.query(
      'SELECT organization_id AS "organizationId" FROM salons WHERE id = $1 AND deleted_at IS NULL',
      [salonId]
    );
    if (!salon.rowCount) throw new ApiError(404, 'Salon was not found');
    const result = await db.query(
      `SELECT id, actor_account_id AS "actorAccountId", actor_context AS "actorContext",
              action, resource_type AS "resourceType", resource_id AS "resourceId",
              changes, created_at AS "createdAt"
       FROM audit_logs
       WHERE salon_id = $1
         AND ($2::varchar IS NULL OR resource_type = $2)
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [salonId, query.resourceType ?? null, query.limit, query.offset]
    );
    const total = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM audit_logs
       WHERE salon_id = $1 AND ($2::varchar IS NULL OR resource_type = $2)`,
      [salonId, query.resourceType ?? null]
    );
    return { items: result.rows, total: total.rows[0]?.total ?? 0, ...query };
  }

  async requestSalonProfileChange(
    salonId: string,
    accountId: string,
    input: SalonProfileChangeRequestInput
  ) {
    const { ownerNote, ...proposedChanges } = input;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const salonResult = await client.query(
        `SELECT salon.organization_id AS "organizationId"
         FROM salons AS salon
         JOIN salon_organizations AS organization ON organization.id = salon.organization_id
         JOIN salon_applications AS application ON application.salon_id = salon.id
         JOIN salon_organization_owners AS owner
           ON owner.organization_id = organization.id AND owner.account_id = $2
         WHERE salon.id = $1 AND salon.status = 'ACTIVE'
           AND organization.status = 'ACTIVE'
           AND salon.deleted_at IS NULL AND organization.deleted_at IS NULL
           AND application.status = 'APPROVED'
         FOR UPDATE OF salon, organization`,
        [salonId, accountId]
      );
      const salon = salonResult.rows[0];
      if (!salon) throw new ApiError(404, 'Approved salon owned by this account was not found');
      const pending = await client.query(
        `SELECT id FROM salon_profile_change_requests
         WHERE salon_id = $1 AND status = 'PENDING' FOR UPDATE`,
        [salonId]
      );
      if (pending.rowCount) throw new ApiError(409, 'A profile change request is already pending');
      const requestId = randomUUID();
      const created = await client.query(
        `INSERT INTO salon_profile_change_requests (
           id, organization_id, salon_id, requested_by_account_id,
           proposed_changes, request_notes
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id, status, created_at AS "createdAt"`,
        [
          requestId,
          salon.organizationId,
          salonId,
          accountId,
          JSON.stringify(proposedChanges),
          ownerNote ?? null,
        ]
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_account_id, actor_context, organization_id, salon_id,
           action, resource_type, resource_id, changes
         )
         VALUES ($1, 'SALON', $2, $3, 'SALON_PROFILE_CHANGE_REQUESTED',
                 'SALON_PROFILE_CHANGE_REQUEST', $4, $5::jsonb)`,
        [
          accountId,
          salon.organizationId,
          salonId,
          requestId,
          JSON.stringify({
            status: 'PENDING',
            proposedChanges,
            ownerNote: ownerNote ?? null,
          }),
        ]
      );
      await client.query('COMMIT');
      return created.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'A profile change request is already pending');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listSalonProfileChangesForOwner(
    salonId: string,
    accountId: string,
    query: AdminPagination
  ) {
    const result = await db.query(
      `SELECT request.id, request.proposed_changes AS "proposedChanges",
              request.request_notes AS "requestNotes", request.status,
              request.reviewed_at AS "reviewedAt", request.review_notes AS "reviewNotes",
              request.created_at AS "createdAt"
       FROM salon_profile_change_requests AS request
       JOIN salon_organization_owners AS owner
         ON owner.organization_id = request.organization_id
       WHERE request.salon_id = $1 AND owner.account_id = $2
       ORDER BY request.created_at DESC, request.id DESC
       LIMIT $3 OFFSET $4`,
      [salonId, accountId, query.limit, query.offset]
    );
    const count = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM salon_profile_change_requests AS request
       JOIN salon_organization_owners AS owner
         ON owner.organization_id = request.organization_id
       WHERE request.salon_id = $1 AND owner.account_id = $2`,
      [salonId, accountId]
    );
    return {
      items: result.rows,
      total: count.rows[0]?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async listSalonProfileChangeRequests(query: AdminPagination & { status: string }) {
    const [requests, count] = await Promise.all([
      db.query(
        `SELECT request.id, request.organization_id AS "organizationId",
                organization.name AS "organizationName", request.salon_id AS "salonId",
                salon.name AS "salonName", salon.city, salon.branch_code AS "branchCode",
                request.requested_by_account_id AS "requestedByAccountId",
                owner.full_name AS "ownerName", owner.email AS "ownerEmail",
                owner.phone_number AS "ownerPhoneNumber",
                request.proposed_changes AS "proposedChanges",
                request.request_notes AS "requestNotes", request.status,
                request.reviewed_by_account_id AS "reviewedByAccountId",
                request.reviewed_at AS "reviewedAt", request.review_notes AS "reviewNotes",
                request.created_at AS "createdAt"
         FROM salon_profile_change_requests AS request
         JOIN salon_organizations AS organization ON organization.id = request.organization_id
         JOIN salons AS salon ON salon.id = request.salon_id
         JOIN accounts AS owner ON owner.id = request.requested_by_account_id
         WHERE request.status = $1
         ORDER BY request.created_at DESC, request.id DESC
         LIMIT $2 OFFSET $3`,
        [query.status, query.limit, query.offset]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total
         FROM salon_profile_change_requests WHERE status = $1`,
        [query.status]
      ),
    ]);
    return {
      items: requests.rows,
      total: count.rows[0]?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
      status: query.status,
    };
  }

  async reviewSalonProfileChangeRequest(
    requestId: string,
    context: AdminActionContext,
    decision: SalonProfileChangeReviewInput
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const requestResult = await client.query(
        `SELECT id, organization_id AS "organizationId", salon_id AS "salonId",
                requested_by_account_id AS "requestedByAccountId",
                proposed_changes AS "proposedChanges", request_notes AS "requestNotes",
                status
         FROM salon_profile_change_requests
         WHERE id = $1
         FOR UPDATE`,
        [requestId]
      );
      const changeRequest = requestResult.rows[0];
      if (!changeRequest) throw new ApiError(404, 'Salon profile change request was not found');
      if (changeRequest.status !== 'PENDING') {
        throw new ApiError(409, 'Salon profile change request has already been reviewed');
      }

      const salonResult = await client.query(
        `SELECT organization.name AS "organizationName",
                organization.legal_name AS "legalName",
                salon.name AS "salonName",
                salon.address_line_1 AS "addressLine1",
                salon.address_line_2 AS "addressLine2",
                salon.city, salon.state, salon.postal_code AS "postalCode",
                salon.country_code AS "countryCode"
         FROM salons AS salon
         JOIN salon_organizations AS organization ON organization.id = salon.organization_id
         WHERE salon.id = $1 AND salon.organization_id = $2
           AND salon.deleted_at IS NULL AND organization.deleted_at IS NULL
         FOR UPDATE OF salon, organization`,
        [changeRequest.salonId, changeRequest.organizationId]
      );
      const before = salonResult.rows[0];
      if (!before) throw new ApiError(404, 'Salon was not found');

      const proposedChanges = changeRequest.proposedChanges as Record<string, unknown>;
      const after = { ...before, ...proposedChanges };
      const changedFields = Object.fromEntries(
        Object.keys(proposedChanges).map((field) => [
          field,
          { before: before[field], after: after[field] },
        ])
      );
      if (decision.status === 'APPROVED') {
        await client.query(
          `UPDATE salon_organizations
           SET name = CASE WHEN $2::jsonb ? 'organizationName'
                           THEN $2::jsonb->>'organizationName' ELSE name END,
               legal_name = CASE WHEN $2::jsonb ? 'legalName'
                                 THEN $2::jsonb->>'legalName' ELSE legal_name END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [changeRequest.organizationId, JSON.stringify(proposedChanges)]
        );
        await client.query(
          `UPDATE salons
           SET name = CASE WHEN $2::jsonb ? 'salonName'
                           THEN $2::jsonb->>'salonName' ELSE name END,
               address_line_1 = CASE WHEN $2::jsonb ? 'addressLine1'
                                     THEN $2::jsonb->>'addressLine1' ELSE address_line_1 END,
               address_line_2 = CASE WHEN $2::jsonb ? 'addressLine2'
                                     THEN $2::jsonb->>'addressLine2' ELSE address_line_2 END,
               city = CASE WHEN $2::jsonb ? 'city'
                           THEN $2::jsonb->>'city' ELSE city END,
               state = CASE WHEN $2::jsonb ? 'state'
                            THEN $2::jsonb->>'state' ELSE state END,
               postal_code = CASE WHEN $2::jsonb ? 'postalCode'
                                  THEN $2::jsonb->>'postalCode' ELSE postal_code END,
               country_code = CASE WHEN $2::jsonb ? 'countryCode'
                                   THEN $2::jsonb->>'countryCode' ELSE country_code END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND organization_id = $3`,
          [changeRequest.salonId, JSON.stringify(proposedChanges), changeRequest.organizationId]
        );
      }

      const reviewed = await client.query(
        `UPDATE salon_profile_change_requests
         SET status = $2, reviewed_by_account_id = $3, reviewed_at = CURRENT_TIMESTAMP,
             review_notes = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING reviewed_at AS "reviewedAt"`,
        [requestId, decision.status, context.actorAccountId, decision.reviewNotes?.trim() || null]
      );
      await this.insertAudit(client, context, {
        salonId: changeRequest.salonId,
        organizationId: changeRequest.organizationId,
        action: decision.status === 'APPROVED'
          ? 'SALON_PROFILE_CHANGE_APPROVED'
          : 'SALON_PROFILE_CHANGE_REJECTED',
        resourceType: decision.status === 'APPROVED'
          ? 'SALON_PROFILE'
          : 'SALON_PROFILE_CHANGE_REQUEST',
        resourceId: decision.status === 'APPROVED' ? changeRequest.salonId : requestId,
        changes: decision.status === 'APPROVED'
          ? {
              profileChangeRequestId: requestId,
              fields: changedFields,
              reviewNotes: decision.reviewNotes?.trim() || null,
            }
          : {
              profileChangeRequestId: requestId,
              status: { before: 'PENDING', after: 'REJECTED' },
              proposedChanges,
              reviewNotes: decision.reviewNotes?.trim() || null,
            },
      });
      await client.query('COMMIT');
      return {
        id: requestId,
        salonId: changeRequest.salonId,
        status: decision.status,
        reviewedAt: reviewed.rows[0].reviewedAt,
        reviewNotes: decision.reviewNotes?.trim() || null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listAccounts(query: AdminAccountListQuery) {
    const filterValues = [
      query.accountType ?? null,
      query.status ?? null,
      query.search ?? null,
    ];
    const [result, count] = await Promise.all([db.query(
      `SELECT account.id, account.account_type AS "accountType",
              account.full_name AS "fullName", account.email,
              account.phone_number AS "phoneNumber", account.status,
              account.email_verified_at AS "emailVerifiedAt",
              account.phone_verified_at AS "phoneVerifiedAt",
              account.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM account_sessions AS session
               WHERE session.account_id = account.id
                 AND session.revoked_at IS NULL
                 AND session.expires_at > CURRENT_TIMESTAMP) AS "activeSessionCount",
              COALESCE((
                SELECT array_agg(DISTINCT organization.name ORDER BY organization.name)
                FROM salon_memberships AS membership
                JOIN salon_organizations AS organization
                  ON organization.id = membership.organization_id
                WHERE membership.account_id = account.id
                  AND membership.status = 'ACTIVE'
                  AND organization.deleted_at IS NULL
              ), ARRAY[]::text[]) AS "organizationNames"
       FROM accounts AS account
       WHERE account.deleted_at IS NULL
         AND ($1::varchar IS NULL OR account.account_type::text = $1)
         AND ($2::varchar IS NULL OR account.status = $2)
         AND ($3::varchar IS NULL OR
              account.full_name ILIKE '%' || $3 || '%' OR
              COALESCE(account.email, '') ILIKE '%' || $3 || '%' OR
              account.phone_number ILIKE '%' || $3 || '%')
       ORDER BY account.created_at DESC, account.id
       LIMIT $4 OFFSET $5`,
      [
        ...filterValues,
        query.limit,
        query.offset,
      ]
    ), db.query(
      `SELECT COUNT(*)::int AS total
       FROM accounts AS account
       WHERE account.deleted_at IS NULL
         AND ($1::varchar IS NULL OR account.account_type::text = $1)
         AND ($2::varchar IS NULL OR account.status = $2)
         AND ($3::varchar IS NULL OR
              account.full_name ILIKE '%' || $3 || '%' OR
              COALESCE(account.email, '') ILIKE '%' || $3 || '%' OR
              account.phone_number ILIKE '%' || $3 || '%')`,
      filterValues
    )]);
    return {
      items: result.rows,
      total: count.rows[0]?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async updateAccountStatus(
    accountId: string,
    context: AdminActionContext,
    update: AdminStatusUpdate
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const accountResult = await client.query<AccountActionRow>(
        `SELECT account.id, account.account_type AS "accountType", account.email,
                account.phone_number AS "phoneNumber", account.status,
                EXISTS (
                  SELECT 1 FROM platform_super_admins AS super_admin
                  WHERE super_admin.account_id = account.id
                ) AS "isSuperAdmin"
         FROM accounts AS account
         WHERE account.id = $1 AND account.deleted_at IS NULL
         FOR UPDATE`,
        [accountId]
      );
      const account = accountResult.rows[0];
      if (!account) throw new ApiError(404, 'Account was not found');
      if (accountId === context.actorAccountId || account.accountType === 'ADMIN' || account.isSuperAdmin) {
        throw new ApiError(409, 'This platform administrator account cannot be changed here');
      }
      if (account.status === update.status) {
        throw new ApiError(409, 'Account already has the requested status');
      }
      if (!['ACTIVE', 'SUSPENDED'].includes(account.status)) {
        throw new ApiError(409, 'Only active or suspended accounts can be changed');
      }

      await client.query(
        'UPDATE accounts SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [accountId, update.status]
      );
      let revokedSessions = 0;
      if (update.status === 'SUSPENDED') {
        const revoked = await client.query(
          `UPDATE account_sessions SET revoked_at = CURRENT_TIMESTAMP
           WHERE account_id = $1 AND revoked_at IS NULL`,
          [accountId]
        );
        revokedSessions = revoked.rowCount ?? 0;
      }
      await this.insertAudit(client, context, {
        action: update.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED',
        resourceType: 'ACCOUNT',
        resourceId: accountId,
        changes: {
          before: { status: account.status },
          after: { status: update.status },
          reason: update.reason,
          revokedSessions,
        },
      });
      await client.query('COMMIT');
      return { id: account.id, status: update.status, revokedSessions };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAccountPasswordResetTarget(accountId: string) {
    const result = await db.query<AccountActionRow>(
      `SELECT account.id, account.account_type AS "accountType", account.email,
              account.email_verified_at AS "emailVerifiedAt",
              account.phone_number AS "phoneNumber",
              account.phone_verified_at AS "phoneVerifiedAt", account.status,
              EXISTS (SELECT 1 FROM platform_super_admins AS super_admin
                      WHERE super_admin.account_id = account.id) AS "isSuperAdmin"
       FROM accounts AS account
       WHERE account.id = $1 AND account.deleted_at IS NULL`,
      [accountId]
    );
    const account = result.rows[0];
    if (!account) throw new ApiError(404, 'Account was not found');
    if (account.accountType === 'ADMIN' || account.isSuperAdmin) {
      throw new ApiError(409, 'Platform administrator password reset must use the existing recovery flow');
    }
    if (account.status !== 'ACTIVE') throw new ApiError(409, 'Only active accounts can request a password reset');
    if (!account.emailVerifiedAt && !account.phoneVerifiedAt) {
      throw new ApiError(409, 'Account has no verified contact for password recovery');
    }
    return {
      accountType: account.accountType as 'CUSTOMER' | 'SALON' | 'PLATFORM' | 'ADMIN',
      identifier: account.email && account.emailVerifiedAt ? account.email : account.phoneNumber,
    };
  }

  async recordAccountPasswordResetRequested(
    accountId: string,
    context: AdminActionContext,
    reason: string
  ) {
    await this.writeAudit(context, {
      action: 'ACCOUNT_PASSWORD_RESET_REQUESTED',
      resourceType: 'ACCOUNT',
      resourceId: accountId,
      changes: { reason, deliveryRequested: true },
    });
  }

  async revokeAccountSessions(accountId: string, context: AdminActionContext, reason: string) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const accountResult = await client.query<AccountActionRow>(
        `SELECT account.id, account.account_type AS "accountType", account.email,
                account.phone_number AS "phoneNumber", account.status,
                EXISTS (SELECT 1 FROM platform_super_admins AS super_admin
                        WHERE super_admin.account_id = account.id) AS "isSuperAdmin"
         FROM accounts AS account
         WHERE account.id = $1 AND account.deleted_at IS NULL
         FOR UPDATE`,
        [accountId]
      );
      const account = accountResult.rows[0];
      if (!account) throw new ApiError(404, 'Account was not found');
      if (account.accountType === 'ADMIN' || account.isSuperAdmin) {
        throw new ApiError(409, 'Platform administrator sessions cannot be revoked here');
      }
      const revoked = await client.query(
        `UPDATE account_sessions SET revoked_at = CURRENT_TIMESTAMP
         WHERE account_id = $1 AND revoked_at IS NULL`,
        [accountId]
      );
      await this.insertAudit(client, context, {
        action: 'ACCOUNT_SESSIONS_REVOKED',
        resourceType: 'ACCOUNT',
        resourceId: accountId,
        changes: { reason, revokedSessions: revoked.rowCount ?? 0 },
      });
      await client.query('COMMIT');
      return { accountId, revokedSessions: revoked.rowCount ?? 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listPlans() {
    const result = await db.query(
      `SELECT plan.id, plan.key, plan.name, plan.description,
              plan.monthly_price::text AS "monthlyPrice", plan.is_active AS "isActive",
              plan.created_at AS "createdAt", plan.updated_at AS "updatedAt",
              COALESCE((
                SELECT jsonb_object_agg(feature.feature_key, feature.feature_value)
                FROM platform_plan_features AS feature WHERE feature.plan_id = plan.id
              ), '{}'::jsonb) AS features
       FROM platform_plan_catalog AS plan
       ORDER BY plan.is_active DESC, plan.monthly_price, plan.name`
    );
    return result.rows;
  }

  async updatePlan(planId: string, context: AdminActionContext, update: AdminPlanUpdate) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const beforeResult = await client.query(
        `SELECT id, key, name, description, monthly_price::text AS "monthlyPrice",
                is_active AS "isActive"
         FROM platform_plan_catalog WHERE id = $1 FOR UPDATE`,
        [planId]
      );
      const before = beforeResult.rows[0];
      if (!before) throw new ApiError(404, 'Plan was not found');
      await client.query(
        `UPDATE platform_plan_catalog
         SET name = $2, description = $3, monthly_price = $4, is_active = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [planId, update.name, update.description, update.monthlyPrice, update.isActive]
      );
      for (const [featureKey, featureValue] of Object.entries(update.features)) {
        await client.query(
          `INSERT INTO platform_plan_features (plan_id, feature_key, feature_value)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (plan_id, feature_key)
           DO UPDATE SET feature_value = EXCLUDED.feature_value`,
          [planId, featureKey, JSON.stringify(featureValue)]
        );
      }
      const features = await client.query(
        'SELECT feature_key AS key, feature_value AS value FROM platform_plan_features WHERE plan_id = $1',
        [planId]
      );
      const requestedKeys = new Set(Object.keys(update.features));
      for (const existing of features.rows) {
        if (!requestedKeys.has(existing.key)) {
          await client.query(
            'UPDATE platform_plan_features SET feature_value = \'null\'::jsonb WHERE plan_id = $1 AND feature_key = $2',
            [planId, existing.key]
          );
        }
      }
      await this.insertAudit(client, context, {
        action: 'PLATFORM_PLAN_UPDATED',
        resourceType: 'PLATFORM_PLAN',
        resourceId: planId,
        changes: { before, after: update, reason: update.reason },
      });
      await client.query('COMMIT');
      return { id: planId, ...update };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listAddons() {
    const result = await db.query(
      `SELECT id, key, name, description, price::text AS price,
              is_recurring AS "isRecurring", is_active AS "isActive", created_at AS "createdAt"
       FROM platform_addons ORDER BY is_active DESC, name`
    );
    return result.rows;
  }

  async updateAddon(addonId: string, context: AdminActionContext, update: AdminAddonUpdate) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query(
        `SELECT id, key, name, description, price::text AS price,
                is_recurring AS "isRecurring", is_active AS "isActive"
         FROM platform_addons WHERE id = $1 FOR UPDATE`,
        [addonId]
      );
      if (!before.rowCount) throw new ApiError(404, 'Add-on was not found');
      const result = await client.query(
        `UPDATE platform_addons
         SET name = $2, description = $3, price = $4, is_recurring = $5, is_active = $6
         WHERE id = $1
         RETURNING id, key, name, description, price::text AS price,
                   is_recurring AS "isRecurring", is_active AS "isActive"`,
        [addonId, update.name, update.description, update.price, update.isRecurring, update.isActive]
      );
      if (!result.rowCount) throw new ApiError(404, 'Add-on was not found');
      await this.insertAudit(client, context, {
        action: 'PLATFORM_ADDON_UPDATED',
        resourceType: 'PLATFORM_ADDON',
        resourceId: addonId,
        changes: { before: before.rows[0], after: update, reason: update.reason },
      });
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async assignPlan(
    salonId: string,
    context: AdminActionContext,
    update: AdminSubscriptionUpdate
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const salonResult = await client.query(
        `SELECT id, organization_id AS "organizationId"
         FROM salons WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [salonId]
      );
      const salon = salonResult.rows[0];
      if (!salon) throw new ApiError(404, 'Salon was not found');
      const planResult = await client.query(
        'SELECT id, name, monthly_price::text AS "monthlyPrice" FROM platform_plan_catalog WHERE id = $1 AND is_active = TRUE FOR SHARE',
        [update.planId]
      );
      if (!planResult.rowCount) throw new ApiError(404, 'Active platform plan was not found');
      const previous = await client.query(
        `SELECT id, plan_id AS "planId", status, billing_cycle_start AS "billingCycleStart",
                billing_cycle_end AS "billingCycleEnd"
         FROM platform_subscriptions
         WHERE salon_id = $1 AND status IN ('ACTIVE', 'PENDING_PAYMENT')
         FOR UPDATE`,
        [salonId]
      );
      await client.query(
        `UPDATE platform_subscriptions SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
         WHERE salon_id = $1 AND status IN ('ACTIVE', 'PENDING_PAYMENT')`,
        [salonId]
      );
      const subscriptionId = randomUUID();
      await client.query(
        `INSERT INTO platform_subscriptions (
           id, organization_id, salon_id, plan_id, status, billing_cycle_start, billing_cycle_end
         ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6)`,
        [
          subscriptionId,
          salon.organizationId,
          salonId,
          update.planId,
          update.billingCycleStart,
          update.billingCycleEnd,
        ]
      );
      await this.insertAudit(client, context, {
        salonId,
        organizationId: salon.organizationId,
        action: 'SALON_PLAN_ASSIGNED',
        resourceType: 'PLATFORM_SUBSCRIPTION',
        resourceId: subscriptionId,
        changes: {
          before: previous.rows,
          after: { ...update, plan: planResult.rows[0] },
          reason: update.reason,
        },
      });
      await client.query('COMMIT');
      return { id: subscriptionId, salonId, ...update };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setAddon(
    salonId: string,
    addonId: string,
    context: AdminActionContext,
    reason: string,
    active: boolean
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const salonResult = await client.query(
        'SELECT organization_id AS "organizationId" FROM salons WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [salonId]
      );
      const salon = salonResult.rows[0];
      if (!salon) throw new ApiError(404, 'Salon was not found');
      const addon = await client.query(
        `SELECT id, is_active AS "isActive" FROM platform_addons
         WHERE id = $1 FOR SHARE`,
        [addonId]
      );
      if (!addon.rowCount || (active && !addon.rows[0].isActive)) {
        throw new ApiError(404, 'Active platform add-on was not found');
      }
      let result: QueryResult<QueryResultRow>;
      if (active) {
        result = await client.query(
          `INSERT INTO platform_salon_addons (salon_id, addon_id, status, activated_at, cancelled_at)
           VALUES ($1, $2, 'ACTIVE', CURRENT_TIMESTAMP, NULL)
           ON CONFLICT (salon_id, addon_id)
           DO UPDATE SET status = 'ACTIVE', activated_at = CURRENT_TIMESTAMP, cancelled_at = NULL
           RETURNING id, status, activated_at AS "activatedAt", cancelled_at AS "cancelledAt"`,
          [salonId, addonId]
        );
      } else {
        const existing = await client.query(
          `UPDATE platform_salon_addons
           SET status = 'INACTIVE', cancelled_at = CURRENT_TIMESTAMP
           WHERE salon_id = $1 AND addon_id = $2 AND status = 'ACTIVE'
           RETURNING id, status, activated_at AS "activatedAt", cancelled_at AS "cancelledAt"`,
          [salonId, addonId]
        );
        if (!existing.rowCount) throw new ApiError(404, 'Active salon add-on was not found');
        result = existing;
      }
      await this.insertAudit(client, context, {
        salonId,
        organizationId: salon.organizationId,
        action: active ? 'SALON_ADDON_GRANTED' : 'SALON_ADDON_REVOKED',
        resourceType: 'PLATFORM_SALON_ADDON',
        resourceId: result.rows[0].id,
        changes: { addonId, status: result.rows[0].status, reason },
      });
      await client.query('COMMIT');
      return { salonId, addonId, ...result.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setEntitlement(
    salonId: string,
    context: AdminActionContext,
    update: AdminEntitlementUpdate
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const salonResult = await client.query(
        'SELECT organization_id AS "organizationId" FROM salons WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [salonId]
      );
      const salon = salonResult.rows[0];
      if (!salon) throw new ApiError(404, 'Salon was not found');
      const previous = await client.query(
        `SELECT feature_value AS "featureValue", reason, expires_at AS "expiresAt"
         FROM platform_salon_entitlement_overrides
         WHERE salon_id = $1 AND feature_key = $2 FOR UPDATE`,
        [salonId, update.featureKey]
      );
      const overrideId = `${salonId}:${update.featureKey}`;
      await client.query(
        `INSERT INTO platform_salon_entitlement_overrides (
           salon_id, feature_key, feature_value, reason, granted_by_account_id, expires_at, updated_at
         )
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, CURRENT_TIMESTAMP)
         ON CONFLICT (salon_id, feature_key)
         DO UPDATE SET feature_value = EXCLUDED.feature_value,
                       reason = EXCLUDED.reason,
                       granted_by_account_id = EXCLUDED.granted_by_account_id,
                       expires_at = EXCLUDED.expires_at,
                       updated_at = CURRENT_TIMESTAMP`,
        [
          salonId,
          update.featureKey,
          JSON.stringify(update.featureValue),
          update.reason,
          context.actorAccountId,
          update.expiresAt,
        ]
      );
      await this.insertAudit(client, context, {
        salonId,
        organizationId: salon.organizationId,
        action: 'SALON_ENTITLEMENT_GRANTED',
        resourceType: 'SALON_ENTITLEMENT_OVERRIDE',
        resourceId: overrideId,
        changes: { before: previous.rows[0] ?? null, after: update },
      });
      await client.query('COMMIT');
      return { salonId, ...update, grantedByAccountId: context.actorAccountId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeEntitlement(
    salonId: string,
    featureKey: string,
    context: AdminActionContext,
    reason: string
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const salonResult = await client.query(
        'SELECT organization_id AS "organizationId" FROM salons WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [salonId]
      );
      const salon = salonResult.rows[0];
      if (!salon) throw new ApiError(404, 'Salon was not found');
      const previous = await client.query(
        `SELECT feature_value AS "featureValue", reason, expires_at AS "expiresAt"
         FROM platform_salon_entitlement_overrides
         WHERE salon_id = $1 AND feature_key = $2 FOR UPDATE`,
        [salonId, featureKey]
      );
      if (!previous.rowCount) throw new ApiError(404, 'Entitlement override was not found');
      await client.query(
        `UPDATE platform_salon_entitlement_overrides
         SET feature_value = 'false'::jsonb, reason = $3,
             granted_by_account_id = $4, expires_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE salon_id = $1 AND feature_key = $2`,
        [salonId, featureKey, reason, context.actorAccountId]
      );
      await this.insertAudit(client, context, {
        salonId,
        organizationId: salon.organizationId,
        action: 'SALON_ENTITLEMENT_REVOKED',
        resourceType: 'SALON_ENTITLEMENT_OVERRIDE',
        resourceId: `${salonId}:${featureKey}`,
        changes: { before: previous.rows[0], after: { featureValue: false, reason } },
      });
      await client.query('COMMIT');
      return { salonId, featureKey, featureValue: false, reason };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listRecentActivity(query: AdminPagination) {
    const [activity, total] = await Promise.all([
      db.query(
        `SELECT audit.id, audit.actor_account_id AS "actorAccountId",
                actor.full_name AS "actorName", audit.actor_context AS "actorContext",
                audit.organization_id AS "organizationId", organization.name AS "organizationName",
                audit.salon_id AS "salonId", salon.name AS "salonName",
                audit.action, audit.resource_type AS "resourceType",
                audit.resource_id AS "resourceId", audit.changes,
                audit.created_at AS "createdAt"
         FROM audit_logs AS audit
         LEFT JOIN accounts AS actor ON actor.id = audit.actor_account_id
         LEFT JOIN salon_organizations AS organization ON organization.id = audit.organization_id
         LEFT JOIN salons AS salon ON salon.id = audit.salon_id
         ORDER BY audit.created_at DESC, audit.id DESC
         LIMIT $1 OFFSET $2`,
        [query.limit, query.offset]
      ),
      db.query('SELECT COUNT(*)::int AS total FROM audit_logs'),
    ]);
    return { items: activity.rows, total: total.rows[0]?.total ?? 0, ...query };
  }

  async getMasterSettings() {
    const [gst, image] = await Promise.all([
      db.query(
        `SELECT is_enabled AS enabled, seller_gstin AS "sellerGstin",
                seller_state_code AS "sellerStateCode", rate_percent::float8 AS "ratePercent",
                updated_by_account_id AS "updatedByAccountId", updated_at AS "updatedAt"
         FROM platform_gst_settings WHERE id = 1`
      ),
      db.query(
        `SELECT service_image_required AS "serviceImageRequired",
                updated_by_account_id AS "updatedByAccountId", updated_at AS "updatedAt"
         FROM platform_service_image_settings WHERE id = TRUE`
      ),
    ]);
    return {
      billing: { gst: gst.rows[0] ?? null },
      services: { imagePolicy: image.rows[0] ?? null },
    };
  }

  private async writeAudit(
    context: AdminActionContext,
    event: {
      salonId?: string;
      organizationId?: string;
      action: string;
      resourceType: string;
      resourceId: string;
      changes: unknown;
    }
  ) {
    await db.query(
      `INSERT INTO audit_logs (
         actor_account_id, actor_context, organization_id, salon_id,
         request_id, ip_address, user_agent, action, resource_type, resource_id, changes
       ) VALUES ($1, 'ADMIN', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        context.actorAccountId,
        event.organizationId ?? null,
        event.salonId ?? null,
        context.requestId,
        context.ipAddress,
        context.userAgent,
        event.action,
        event.resourceType,
        event.resourceId,
        JSON.stringify(event.changes),
      ]
    );
  }

  private async insertAudit(
    client: PoolClient,
    context: AdminActionContext,
    event: {
      salonId?: string;
      organizationId?: string;
      action: string;
      resourceType: string;
      resourceId: string;
      changes: unknown;
    }
  ) {
    await client.query(
      `INSERT INTO audit_logs (
         actor_account_id, actor_context, organization_id, salon_id,
         request_id, ip_address, user_agent, action, resource_type, resource_id, changes
       ) VALUES ($1, 'ADMIN', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        context.actorAccountId,
        event.organizationId ?? null,
        event.salonId ?? null,
        context.requestId,
        context.ipAddress,
        context.userAgent,
        event.action,
        event.resourceType,
        event.resourceId,
        JSON.stringify(event.changes),
      ]
    );
  }
}
