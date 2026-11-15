import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type { CreateStaffAccountRequest, StaffAccountLinkResponse } from './staff-onboarding.types.js';

export class StaffOnboardingRepository {
  async assertOwnerCanManageStaff(ownerAccountId: string, salonId: string): Promise<void> {
    const result = await db.query(
      `SELECT 1
       FROM salon_organization_owners AS owner
       JOIN salons AS salon
         ON salon.organization_id = owner.organization_id
       JOIN salon_applications AS application
         ON application.salon_id = salon.id
       WHERE owner.account_id = $1
         AND salon.id = $2
         AND salon.status = 'ACTIVE'
         AND application.status = 'APPROVED'
         AND salon.deleted_at IS NULL`,
      [ownerAccountId, salonId]
    );
    if (!result.rowCount) {
      throw new ApiError(404, 'Approved salon owner access was not found');
    }
  }

  async createOrLinkStaffAccount(
    ownerAccountId: string,
    salonId: string,
    data: CreateStaffAccountRequest,
    passwordHash?: string
  ): Promise<StaffAccountLinkResponse> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const salonResult = await client.query(
        `SELECT salon.id, salon.organization_id
         FROM salons AS salon
         JOIN salon_applications AS application
           ON application.salon_id = salon.id
         JOIN salon_organization_owners AS owner
           ON owner.organization_id = salon.organization_id
         WHERE salon.id = $1
           AND owner.account_id = $2
           AND salon.status = 'ACTIVE'
           AND application.status = 'APPROVED'
           AND salon.deleted_at IS NULL
         FOR UPDATE OF salon`,
        [salonId, ownerAccountId]
      );
      const salon = salonResult.rows[0];
      if (!salon) throw new ApiError(404, 'Approved salon owner access was not found');

      let account = await client.query(
        `SELECT id, status, phone_verified_at
         FROM accounts
         WHERE account_type = 'SALON'
           AND phone_number = $1
           AND deleted_at IS NULL
         FOR UPDATE`,
        [data.phone_number]
      );
      let accountId: string;
      let accountLink: StaffAccountLinkResponse['accountLink'];
      if (account.rows[0]) {
        if (account.rows[0].status !== 'ACTIVE' || !account.rows[0].phone_verified_at) {
          throw new ApiError(409, 'The existing salon account is not active and phone-verified');
        }
        accountId = account.rows[0].id;
        accountLink = 'LINKED';
      } else {
        if (!passwordHash || !data.full_name) {
          throw new ApiError(400, 'A full name and password are required to create a new salon account');
        }
        const created = await client.query(
          `INSERT INTO accounts (
             account_type, email, password_hash, full_name, phone_number,
             status, phone_verified_at
           )
           VALUES ('SALON', $1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP)
           RETURNING id`,
          [
            data.email?.trim().toLowerCase() || null,
            passwordHash,
            data.full_name.trim(),
            data.phone_number,
          ]
        );
        accountId = created.rows[0].id;
        accountLink = 'CREATED';
      }

      const membershipResult = await client.query(
        `INSERT INTO salon_memberships (
           organization_id, account_id, status, joined_at
         )
         VALUES ($1, $2, 'ACTIVE', CURRENT_TIMESTAMP)
         ON CONFLICT (organization_id, account_id) DO UPDATE
         SET status = 'ACTIVE', joined_at = COALESCE(salon_memberships.joined_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         RETURNING id, status`,
        [salon.organization_id, accountId]
      );
      const membership = membershipResult.rows[0];
      if (membership.status !== 'ACTIVE') {
        throw new ApiError(409, 'The salon membership could not be activated');
      }

      await client.query(
        `INSERT INTO salon_membership_locations (membership_id, organization_id, salon_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (membership_id, salon_id) DO NOTHING`,
        [membership.id, salon.organization_id, salonId]
      );
      await client.query(
        `INSERT INTO salon_membership_roles (membership_id, organization_id, salon_id, role_id)
         SELECT $1, $2, $3, role.id
         FROM salon_roles AS role
         WHERE role.organization_id = $2 AND role.key = 'STYLIST'
         ON CONFLICT DO NOTHING`,
        [membership.id, salon.organization_id, salonId]
      );
      await client.query(
        `INSERT INTO salon_staff_profiles (membership_id, organization_id, account_id, commission_rate)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (membership_id) DO NOTHING`,
        [
          membership.id,
          salon.organization_id,
          accountId,
          data.commission_rate ?? 0,
        ]
      );

      if (data.expertise?.length) {
        const validServices = await client.query(
          `SELECT id
           FROM salon_services
           WHERE salon_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE`,
          [salonId, data.expertise]
        );
        if (validServices.rowCount !== new Set(data.expertise).size) {
          throw new ApiError(400, 'One or more selected services are not active at this salon');
        }
        await client.query(
          `INSERT INTO salon_staff_skills (membership_id, salon_id, service_id)
           SELECT $1, $2, service.id
           FROM salon_services AS service
           WHERE service.salon_id = $2 AND service.id = ANY($3::uuid[])
           ON CONFLICT (membership_id, service_id) DO NOTHING`,
          [membership.id, salonId, data.expertise]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (
           actor_account_id, actor_context, organization_id, salon_id,
           action, resource_type, resource_id, changes
         )
         VALUES ($1, 'SALON', $2, $3, $4, 'SALON_MEMBERSHIP', $5, $6::jsonb)`,
        [
          ownerAccountId,
          salon.organization_id,
          salonId,
          accountLink === 'CREATED' ? 'SALON_STAFF_ACCOUNT_CREATED' : 'SALON_STAFF_ACCOUNT_LINKED',
          membership.id,
          JSON.stringify({ accountId, role: 'STYLIST', accountLink }),
        ]
      );

      await client.query('COMMIT');
      return {
        accountId,
        membershipId: membership.id,
        salonId,
        accountLink,
        role: 'STYLIST',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'This email or phone is already used by a salon account');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
