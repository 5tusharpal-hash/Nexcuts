import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
  CreateOrganizationRequest,
  OrganizationSetupResponse,
  ReviewSalonApplicationRequest,
  SalonApplicationSummary,
  SalonMembershipSummary,
} from './tenancy.types.js';

export class TenancyRepository {
  async createOrganizationForOwner(
    accountId: string,
    data: CreateOrganizationRequest
  ): Promise<OrganizationSetupResponse> {
    const client = await db.connect();
    const organizationId = randomUUID();
    const salonId = randomUUID();
    const membershipId = randomUUID();
    const applicationId = randomUUID();
    const organizationName = data.organizationName?.trim() || data.firstSalon.name.trim();
    const branchCode = data.firstSalon.branchCode?.trim() || 'MAIN';

    try {
      await client.query('BEGIN');
      const account = await client.query(
        `SELECT account_type, status, phone_verified_at
         FROM accounts
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [accountId]
      );
      if (
        account.rows[0]?.account_type !== 'SALON' ||
        account.rows[0]?.status !== 'ACTIVE' ||
        !account.rows[0]?.phone_verified_at
      ) {
        throw new ApiError(403, 'An active salon account with a verified phone is required');
      }

      await client.query(
        `INSERT INTO salon_organizations (id, name, legal_name)
         VALUES ($1, $2, $3)`,
        [organizationId, organizationName, data.legalName?.trim() || null]
      );
      await client.query(
        `INSERT INTO salons (
           id, organization_id, branch_code, name, address_line_1, address_line_2,
           city, state, postal_code, country_code, timezone
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          salonId,
          organizationId,
          branchCode,
          data.firstSalon.name.trim(),
          data.firstSalon.addressLine1?.trim() || null,
          data.firstSalon.addressLine2?.trim() || null,
          data.firstSalon.city?.trim() || null,
          data.firstSalon.state?.trim() || null,
          data.firstSalon.postalCode?.trim() || null,
          data.firstSalon.countryCode ?? 'IN',
          data.firstSalon.timezone ?? 'Asia/Kolkata',
        ]
      );
      await client.query(
        `INSERT INTO salon_memberships (id, organization_id, account_id, status, joined_at)
         VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP)`,
        [membershipId, organizationId, accountId]
      );
      await client.query(
        `INSERT INTO salon_membership_locations (membership_id, organization_id, salon_id)
         VALUES ($1, $2, $3)`,
        [membershipId, organizationId, salonId]
      );
      await client.query(
        `INSERT INTO salon_organization_owners (organization_id, account_id, membership_id)
         VALUES ($1, $2, $3)`,
        [organizationId, accountId, membershipId]
      );

      await client.query(
        `INSERT INTO salon_roles (organization_id, key, name, description, is_system, created_by_account_id)
         VALUES ($1, 'STYLIST', 'Stylist', 'Salon service provider', TRUE, $2)
         ON CONFLICT (organization_id, key) DO NOTHING`,
        [organizationId, accountId]
      );
      await client.query(
        `INSERT INTO salon_applications (
           id, organization_id, salon_id, applicant_account_id, business_type, proposed_services
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          applicationId,
          organizationId,
          salonId,
          accountId,
          data.businessType,
          JSON.stringify(data.services ?? []),
        ]
      );
      await this.upsertBusinessHours(client, salonId, data.businessHours);
      await client.query(
        `INSERT INTO audit_logs (
           actor_account_id, actor_context, organization_id, salon_id,
           action, resource_type, resource_id, changes
         )
         VALUES ($1, 'SALON', $2, $3, 'SALON_APPLICATION_SUBMITTED',
                 'SALON_APPLICATION', $4, $5::jsonb)`,
        [
          accountId,
          organizationId,
          salonId,
          applicationId,
          JSON.stringify({ status: 'PENDING', businessType: data.businessType }),
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'A salon application with this branch code already exists');
      }
      throw error;
    } finally {
      client.release();
    }

    return {
      organization: {
        id: organizationId,
        name: organizationName,
        status: 'PENDING',
      },
      salon: {
        id: salonId,
        organizationId,
        branchCode,
        name: data.firstSalon.name.trim(),
        status: 'PENDING',
      },
      application: { id: applicationId, status: 'PENDING' },
    };
  }

  async updateApplication(
    accountId: string,
    salonId: string,
    data: CreateOrganizationRequest
  ): Promise<SalonApplicationSummary> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const applicationResult = await client.query(
        `SELECT application.id, application.organization_id, application.status,
                organization.name AS organization_name,
                organization.legal_name,
                salon.branch_code,
                salon.name AS salon_name,
                salon.address_line_1,
                salon.address_line_2,
                salon.city,
                salon.state,
                salon.postal_code,
                salon.country_code,
                salon.timezone
         FROM salon_applications AS application
         JOIN salon_organization_owners AS owner
           ON owner.organization_id = application.organization_id
         JOIN salon_organizations AS organization
           ON organization.id = application.organization_id
         JOIN salons AS salon ON salon.id = application.salon_id
         WHERE application.salon_id = $1 AND owner.account_id = $2
         FOR UPDATE OF application, organization, salon`,
        [salonId, accountId]
      );
      const application = applicationResult.rows[0];
      if (!application) throw new ApiError(404, 'Salon application not found');
      if (!['PENDING', 'CHANGES_REQUESTED'].includes(application.status)) {
        throw new ApiError(409, 'This salon application can no longer be edited');
      }

      const organizationName = data.organizationName?.trim() || data.firstSalon.name.trim();
      const beforeProfile = {
        organizationName: application.organization_name,
        legalName: application.legal_name,
        branchCode: application.branch_code,
        salonName: application.salon_name,
        addressLine1: application.address_line_1,
        addressLine2: application.address_line_2,
        city: application.city,
        state: application.state,
        postalCode: application.postal_code,
        countryCode: application.country_code,
        timezone: application.timezone,
      };
      const afterProfile = {
        organizationName,
        legalName: data.legalName?.trim() || null,
        branchCode: data.firstSalon.branchCode?.trim() || 'MAIN',
        salonName: data.firstSalon.name.trim(),
        addressLine1: data.firstSalon.addressLine1?.trim() || null,
        addressLine2: data.firstSalon.addressLine2?.trim() || null,
        city: data.firstSalon.city?.trim() || null,
        state: data.firstSalon.state?.trim() || null,
        postalCode: data.firstSalon.postalCode?.trim() || null,
        countryCode: data.firstSalon.countryCode ?? 'IN',
        timezone: data.firstSalon.timezone ?? 'Asia/Kolkata',
      };
      await client.query(
        `UPDATE salon_organizations
         SET name = $2, legal_name = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [application.organization_id, organizationName, data.legalName?.trim() || null]
      );
      await client.query(
        `UPDATE salons
         SET branch_code = $2, name = $3, address_line_1 = $4, address_line_2 = $5,
             city = $6, state = $7, postal_code = $8, country_code = $9, timezone = $10,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [
          salonId,
          data.firstSalon.branchCode?.trim() || 'MAIN',
          data.firstSalon.name.trim(),
          data.firstSalon.addressLine1?.trim() || null,
          data.firstSalon.addressLine2?.trim() || null,
          data.firstSalon.city?.trim() || null,
          data.firstSalon.state?.trim() || null,
          data.firstSalon.postalCode?.trim() || null,
          data.firstSalon.countryCode ?? 'IN',
          data.firstSalon.timezone ?? 'Asia/Kolkata',
        ]
      );
      await client.query(
        `UPDATE salon_applications
         SET business_type = $2, proposed_services = $3::jsonb, status = 'PENDING',
             submitted_at = CURRENT_TIMESTAMP, reviewed_by_account_id = NULL,
             reviewed_at = NULL, review_notes = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [application.id, data.businessType, JSON.stringify(data.services ?? [])]
      );
      await this.upsertBusinessHours(client, salonId, data.businessHours);
      const updated = await this.findApplicationBySalonId(client, salonId);
      await client.query(
        `INSERT INTO audit_logs (
           actor_account_id, actor_context, organization_id, salon_id,
           action, resource_type, resource_id, changes
         )
         VALUES ($1, 'SALON', $2, $3, 'SALON_APPLICATION_RESUBMITTED',
                 'SALON_APPLICATION', $4, $5::jsonb)`,
        [
          accountId,
          application.organization_id,
          salonId,
          application.id,
          JSON.stringify({ status: 'PENDING', businessType: data.businessType }),
        ]
      );
      const profileChanges = Object.fromEntries(
        Object.entries(afterProfile)
          .filter(([key, value]) => beforeProfile[key as keyof typeof beforeProfile] !== value)
          .map(([key, value]) => [
            key,
            { before: beforeProfile[key as keyof typeof beforeProfile], after: value },
          ])
      );
      if (Object.keys(profileChanges).length > 0) {
        await client.query(
          `INSERT INTO audit_logs (
             actor_account_id, actor_context, organization_id, salon_id,
             action, resource_type, resource_id, changes
           )
           VALUES ($1, 'SALON', $2, $3, 'SALON_PROFILE_UPDATED',
                   'SALON_PROFILE', $3, $4::jsonb)`,
          [
            accountId,
            application.organization_id,
            salonId,
            JSON.stringify({ fields: profileChanges }),
          ]
        );
      }
      await client.query('COMMIT');
      if (!updated) throw new ApiError(500, 'Updated salon application could not be loaded');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'The branch code is already in use for this organization');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findApplicationsForOwner(accountId: string): Promise<SalonApplicationSummary[]> {
    const result = await db.query<SalonApplicationSummary>(
      `${this.applicationSelect}
       JOIN salon_organization_owners AS owner
         ON owner.organization_id = application.organization_id
       WHERE owner.account_id = $1
       ORDER BY application.submitted_at DESC`,
      [accountId]
    );
    return result.rows;
  }

  async findApplicationsForReview(query: {
    limit: number;
    offset: number;
    status?: string;
  }): Promise<SalonApplicationSummary[]> {
    const result = await db.query<SalonApplicationSummary>(
      `${this.applicationSelect}
       WHERE ($1::varchar IS NULL OR application.status = $1)
       ORDER BY application.submitted_at DESC
       LIMIT $2 OFFSET $3`,
      [query.status ?? null, query.limit, query.offset]
    );
    return result.rows;
  }

  async reviewApplication(
    adminAccountId: string,
    salonId: string,
    review: ReviewSalonApplicationRequest
  ): Promise<SalonApplicationSummary> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT application.id, application.organization_id, application.business_type,
                application.proposed_services, application.status
         FROM salon_applications AS application
         WHERE application.salon_id = $1
         FOR UPDATE`,
        [salonId]
      );
      const application = result.rows[0];
      if (!application) throw new ApiError(404, 'Salon application not found');
      if (!['PENDING', 'CHANGES_REQUESTED'].includes(application.status)) {
        throw new ApiError(409, 'This salon application has already been reviewed');
      }

      await client.query(
        `UPDATE salon_applications
         SET status = $2, reviewed_by_account_id = $3, reviewed_at = CURRENT_TIMESTAMP,
             review_notes = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [application.id, review.status, adminAccountId, review.reviewNotes?.trim() || null]
      );

      if (review.status === 'APPROVED') {
        await client.query(
          `UPDATE salon_organizations
           SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [application.organization_id]
        );
        await client.query(
          `UPDATE salons
           SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [salonId]
        );
        await client.query(
          `INSERT INTO salon_services (
             salon_id, name, description, estimated_duration_minutes, base_price, target_audience
           )
           SELECT $1, service.name, service.description,
                  service."estimatedDurationMinutes", service."basePrice",
                  service."targetAudience"
           FROM jsonb_to_recordset($2::jsonb) AS service(
             name text,
             description text,
             "estimatedDurationMinutes" integer,
             "basePrice" numeric,
             "targetAudience" text
           )`,
          [salonId, JSON.stringify(application.proposed_services ?? [])]
        );
        if (application.business_type === 'SOLO') {
          await this.activateSoloOwnerAsStylist(client, application.organization_id, salonId);
        }
      }

      const updated = await this.findApplicationBySalonId(client, salonId);
      await client.query(
        `INSERT INTO audit_logs (
           actor_account_id, actor_context, organization_id, salon_id,
           action, resource_type, resource_id, changes
         )
         VALUES ($1, 'ADMIN', $2, $3, $4, 'SALON_APPLICATION', $5, $6::jsonb)`,
        [
          adminAccountId,
          application.organization_id,
          salonId,
          `SALON_APPLICATION_${review.status}`,
          application.id,
          JSON.stringify({
            previousStatus: application.status,
            status: review.status,
            reviewNotes: review.reviewNotes?.trim() || null,
          }),
        ]
      );
      await client.query('COMMIT');
      if (!updated) throw new ApiError(500, 'Reviewed salon application could not be loaded');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findSalonsForAccount(accountId: string): Promise<SalonMembershipSummary[]> {
    const result = await db.query<SalonMembershipSummary>(
      `SELECT
         membership.id,
         membership.organization_id AS "organizationId",
         organization.name AS "organizationName",
         salon.id AS "salonId",
         salon.branch_code AS "branchCode",
         salon.name AS "salonName",
         membership.status AS "membershipStatus",
         salon.status AS "salonStatus",
         application.status AS "applicationStatus",
         COALESCE(
           array_agg(DISTINCT role.key) FILTER (WHERE role.key IS NOT NULL),
           ARRAY[]::text[]
         ) AS roles
       FROM salon_memberships AS membership
       JOIN salon_organizations AS organization
         ON organization.id = membership.organization_id
       JOIN salon_membership_locations AS location
         ON location.membership_id = membership.id
        AND location.organization_id = membership.organization_id
       JOIN salons AS salon
         ON salon.id = location.salon_id
        AND salon.organization_id = location.organization_id
       JOIN salon_applications AS application
         ON application.salon_id = salon.id
       LEFT JOIN salon_membership_roles AS assignment
         ON assignment.membership_id = membership.id
        AND assignment.salon_id = salon.id
       LEFT JOIN salon_roles AS role
         ON role.id = assignment.role_id
        AND role.organization_id = membership.organization_id
       WHERE membership.account_id = $1
         AND membership.status = 'ACTIVE'
         AND organization.deleted_at IS NULL
         AND salon.deleted_at IS NULL
       GROUP BY membership.id, organization.id, salon.id
       ORDER BY organization.name, salon.name`,
      [accountId]
    );
    return result.rows;
  }

  private readonly applicationSelect = `
    SELECT
      application.id,
      application.organization_id AS "organizationId",
      organization.name AS "organizationName",
      salon.id AS "salonId",
      salon.branch_code AS "branchCode",
      salon.name AS "salonName",
      salon.address_line_1 AS "addressLine1",
      salon.address_line_2 AS "addressLine2",
      salon.city,
      salon.state,
      salon.postal_code AS "postalCode",
      salon.country_code AS "countryCode",
      salon.timezone,
      application.business_type AS "businessType",
      application.status,
      application.proposed_services AS "proposedServices",
      application.review_notes AS "reviewNotes",
      application.submitted_at AS "submittedAt",
      application.reviewed_at AS "reviewedAt",
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'dayOfWeek', hours.day_of_week,
              'isClosed', hours.is_closed,
              'opensAt', to_char(hours.opens_at, 'HH24:MI'),
              'closesAt', to_char(hours.closes_at, 'HH24:MI')
            ) ORDER BY hours.day_of_week
          )
          FROM salon_business_hours AS hours
          WHERE hours.salon_id = salon.id
        ),
        '[]'::json
      ) AS "businessHours"
    FROM salon_applications AS application
    JOIN salon_organizations AS organization
      ON organization.id = application.organization_id
    JOIN salons AS salon
      ON salon.id = application.salon_id
  `;

  private async findApplicationBySalonId(
    client: PoolClient,
    salonId: string
  ): Promise<SalonApplicationSummary | undefined> {
    const result = await client.query<SalonApplicationSummary>(
      `${this.applicationSelect}
       WHERE application.salon_id = $1`,
      [salonId]
    );
    return result.rows[0];
  }

  private async upsertBusinessHours(
    client: PoolClient,
    salonId: string,
    hours: CreateOrganizationRequest['businessHours']
  ) {
    if (!hours) return;
    for (const day of hours) {
      await client.query(
        `INSERT INTO salon_business_hours (salon_id, day_of_week, is_closed, opens_at, closes_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (salon_id, day_of_week) DO UPDATE
         SET is_closed = EXCLUDED.is_closed,
             opens_at = EXCLUDED.opens_at,
             closes_at = EXCLUDED.closes_at,
             updated_at = CURRENT_TIMESTAMP`,
        [
          salonId,
          day.dayOfWeek,
          day.isClosed,
          day.isClosed ? null : day.opensAt,
          day.isClosed ? null : day.closesAt,
        ]
      );
    }
  }

  private async activateSoloOwnerAsStylist(
    client: PoolClient,
    organizationId: string,
    salonId: string
  ) {
    const owner = await client.query(
      `SELECT membership_id, account_id
       FROM salon_organization_owners
       WHERE organization_id = $1`,
      [organizationId]
    );
    if (!owner.rows[0]) throw new ApiError(500, 'Salon owner membership was not found');
    await client.query(
      `INSERT INTO salon_staff_profiles (membership_id, organization_id, account_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (membership_id) DO NOTHING`,
      [owner.rows[0].membership_id, organizationId, owner.rows[0].account_id]
    );
    await client.query(
      `INSERT INTO salon_membership_roles (membership_id, organization_id, salon_id, role_id)
       SELECT $1, $2, $3, role.id
       FROM salon_roles AS role
       WHERE role.organization_id = $2 AND role.key = 'STYLIST'
       ON CONFLICT DO NOTHING`,
      [owner.rows[0].membership_id, organizationId, salonId]
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}
