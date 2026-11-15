import { RbacRepository } from './rbac.repository.js';
import type { UserPermissions } from './rbac.types.js';

export class RbacService {
  private rbacRepo = new RbacRepository();

  /**
   * Calculates the "Effective Permissions" for a user at a specific salon.
   * Aggregates all permissions from all roles assigned to the user for that salon.
   */
  async getEffectivePermissions(userId: string, salonId: string): Promise<UserPermissions> {
    return this.rbacRepo.getEffectiveAccess(userId, salonId);
  }

  createRole(name: string, salonId: string, creatorAccountId: string) {
    return this.rbacRepo.createRole(name, salonId, creatorAccountId);
  }

  getPermissionsForRole(roleId: string) {
    return this.rbacRepo.getPermissionsForRole(roleId);
  }

  assignPermissionToRole(roleId: string, permissionKey: string, salonId: string) {
    return this.rbacRepo.assignPermissionToRole(roleId, permissionKey, salonId);
  }

  assignRoleToUser(userId: string, roleId: string, salonId: string) {
    return this.rbacRepo.assignRoleToUser(userId, roleId, salonId);
  }
}
