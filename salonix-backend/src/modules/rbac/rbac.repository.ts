import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type { Permission, Role } from './rbac.types.js';

export class RbacRepository {
  async getPermissionsForRole(roleId: string): Promise<string[]> {
    const query = `
      SELECT permission_key AS key
      FROM salon_role_permissions
      WHERE role_id = $1
    `;
    const result = await db.query(query, [roleId]);
    return result.rows.map(row => row.key);
  }

  async getUserRolesForSalon(userId: string, salonId: string): Promise<string[]> {
    const query = `
      SELECT DISTINCT r.id
      FROM salon_memberships m
      JOIN salon_membership_locations ml
        ON ml.membership_id = m.id
      JOIN salon_membership_roles mr
        ON mr.membership_id = m.id AND mr.salon_id = ml.salon_id
      JOIN salon_roles r
        ON r.id = mr.role_id AND r.organization_id = m.organization_id
      JOIN salons s ON s.id = ml.salon_id AND s.organization_id = m.organization_id
      JOIN salon_applications application ON application.salon_id = s.id
      WHERE m.account_id = $1
        AND ml.salon_id = $2
        AND m.status = 'ACTIVE'
        AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
        AND application.status = 'APPROVED'
    `;
    const result = await db.query(query, [userId, salonId]);
    return result.rows.map(row => row.id);
  }

  async getEffectiveAccess(userId: string, salonId: string): Promise<{ permissions: string[]; roles: string[] }> {
    const ownerResult = await db.query(
      `SELECT 1
       FROM salon_organization_owners o
       JOIN salons s ON s.organization_id = o.organization_id
      JOIN salon_applications application
        ON application.salon_id = s.id
      WHERE o.account_id = $1
        AND s.id = $2
        AND s.status = 'ACTIVE'
        AND s.deleted_at IS NULL
        AND application.status = 'APPROVED'`,
      [userId, salonId]
    );
    const roleResult = await db.query(
      `SELECT DISTINCT r.id, r.key
       FROM salon_memberships m
       JOIN salon_membership_locations ml
         ON ml.membership_id = m.id
       JOIN salon_membership_roles mr
         ON mr.membership_id = m.id AND mr.salon_id = ml.salon_id
       JOIN salon_roles r
         ON r.id = mr.role_id AND r.organization_id = m.organization_id
       JOIN salons s ON s.id = ml.salon_id AND s.organization_id = m.organization_id
       JOIN salon_applications application ON application.salon_id = s.id
       WHERE m.account_id = $1
         AND ml.salon_id = $2
         AND m.status = 'ACTIVE'
         AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
         AND application.status = 'APPROVED'`,
      [userId, salonId]
    );
    const isOwner = ownerResult.rowCount !== null && ownerResult.rowCount > 0;
    const permissionResult = isOwner
      ? await db.query('SELECT key FROM salon_permissions')
      : await db.query(
        `SELECT DISTINCT rp.permission_key AS key
         FROM salon_memberships m
         JOIN salon_membership_locations ml
           ON ml.membership_id = m.id
         JOIN salon_membership_roles mr
           ON mr.membership_id = m.id AND mr.salon_id = ml.salon_id
         JOIN salons s ON s.id = ml.salon_id AND s.organization_id = m.organization_id
         JOIN salon_applications application ON application.salon_id = s.id
         JOIN salon_role_permissions rp ON rp.role_id = mr.role_id
         WHERE m.account_id = $1
           AND ml.salon_id = $2
           AND m.status = 'ACTIVE'
           AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
           AND application.status = 'APPROVED'`,
        [userId, salonId]
      );
    const roles = roleResult.rows.map(row => row.key as string);
    if (isOwner) roles.unshift('OWNER');
    return {
      permissions: permissionResult.rows.map(row => row.key as string),
      roles: [...new Set(roles)],
    };
  }

  async createPermission(key: string, description: string): Promise<Permission> {
    const query = `
      INSERT INTO salon_permissions (key, description)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description
      RETURNING key, description
    `;
    const result = await db.query(query, [key, description]);
    return result.rows[0];
  }

  async createRole(name: string, salonId: string, createdByAccountId: string): Promise<Role> {
    const key = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key) throw new ApiError(400, 'Role name must contain letters or numbers');

    const query = `
      INSERT INTO salon_roles (organization_id, key, name, created_by_account_id)
      SELECT salon.organization_id, $2, $3, $4
      FROM salons AS salon
      WHERE salon.id = $1
        AND salon.deleted_at IS NULL
      RETURNING id, organization_id, key, name
    `;
    const result = await db.query(query, [salonId, key, name.trim(), createdByAccountId]);
    if (!result.rows[0]) throw new ApiError(404, 'Salon not found');
    return result.rows[0];
  }

  async assignPermissionToRole(roleId: string, permissionKey: string, salonId: string): Promise<void> {
    const query = `
      INSERT INTO salon_role_permissions (role_id, permission_key)
      SELECT role.id, permission.key
      FROM salon_roles AS role
      JOIN salons AS salon ON salon.organization_id = role.organization_id
      JOIN salon_permissions AS permission ON permission.key = $2
      WHERE role.id = $1 AND salon.id = $3 AND role.is_system = FALSE
      ON CONFLICT (role_id, permission_key) DO NOTHING
      RETURNING role_id
    `;
    const result = await db.query(query, [roleId, permissionKey, salonId]);
    if (!result.rows[0]) throw new ApiError(404, 'Salon role or permission not found');
  }

  async assignRoleToUser(userId: string, roleId: string, salonId: string): Promise<void> {
    const query = `
      WITH target AS (
        SELECT m.id AS membership_id, m.organization_id, ml.salon_id, r.id AS role_id
        FROM salon_memberships m
        JOIN salon_membership_locations ml ON ml.membership_id = m.id
        JOIN salon_roles r ON r.organization_id = m.organization_id
        WHERE m.account_id = $1
          AND r.id = $2
          AND ml.salon_id = $3
          AND m.status = 'ACTIVE'
      ),
      assigned AS (
        INSERT INTO salon_membership_roles (membership_id, organization_id, salon_id, role_id)
        SELECT membership_id, organization_id, salon_id, role_id
        FROM target
        ON CONFLICT (membership_id, role_id, salon_id) DO NOTHING
        RETURNING membership_id
      )
      SELECT EXISTS (SELECT 1 FROM target) AS target_exists
    `;
    const result = await db.query(query, [userId, roleId, salonId]);
    if (!result.rows[0]?.target_exists) {
      throw new ApiError(404, 'Active salon membership, location assignment, or role not found');
    }
  }
}
