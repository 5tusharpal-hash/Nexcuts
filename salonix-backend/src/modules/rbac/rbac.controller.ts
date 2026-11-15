import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { RbacService } from './rbac.service.js';

export class RbacController {
  constructor(private readonly service: RbacService) {}

  async getMyAccess(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    const salonId = requireRouteParam(request.params, 'salonId');
    const validatedSalonId = z.string().uuid().parse(salonId);
    const access = await this.service.getEffectivePermissions(request.user.id, validatedSalonId);
    return { success: true, data: access };
  }

  async createRole(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    const salonId = requireRouteParam(request.params, 'salonId');
    const { name } = z.object({ name: z.string().trim().min(2).max(120) }).parse(request.body);
    const validatedSalonId = z.string().uuid().parse(salonId);
    const role = await this.service.createRole(name, validatedSalonId, request.user.id);
    return reply.status(201).send({ success: true, data: role });
  }

  async assignPermission(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    const salonId = requireRouteParam(request.params, 'salonId');
    const roleId = z.string().uuid().parse(
      (request.params as Record<string, unknown>).roleId
    );
    const permissionKey = z.string().min(1).max(120).parse(
      (request.params as Record<string, unknown>).permissionKey
    );
    const validatedSalonId = z.string().uuid().parse(salonId);
    await this.assertPermissionIsGrantable(
      request.user.id,
      request.user.is_super_admin,
      validatedSalonId,
      permissionKey
    );
    await this.service.assignPermissionToRole(roleId, permissionKey, validatedSalonId);
    return { success: true, data: { roleId, permissionKey } };
  }

  async assignRole(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    const salonId = requireRouteParam(request.params, 'salonId');
    const accountId = z.string().uuid().parse(
      (request.params as Record<string, unknown>).accountId
    );
    const roleId = z.string().uuid().parse(
      (request.params as Record<string, unknown>).roleId
    );

    if (!request.user.is_super_admin) {
      const [access, rolePermissions] = await Promise.all([
        this.service.getEffectivePermissions(request.user.id, z.string().uuid().parse(salonId)),
        this.service.getPermissionsForRole(roleId),
      ]);
      if (!rolePermissions.every((permission) => access.permissions.includes(permission))) {
        throw new ApiError(403, 'You cannot assign a role with permissions you do not hold');
      }
    }

    const validatedSalonId = z.string().uuid().parse(salonId);
    await this.service.assignRoleToUser(accountId, roleId, validatedSalonId);
    return { success: true, data: { accountId, roleId, salonId: validatedSalonId } };
  }

  private async assertPermissionIsGrantable(
    accountId: string,
    isSuperAdmin: boolean,
    salonId: string,
    permissionKey: string
  ) {
    if (isSuperAdmin) return;
    const access = await this.service.getEffectivePermissions(accountId, salonId);
    if (!access.permissions.includes(permissionKey)) {
      throw new ApiError(403, 'You cannot grant a permission you do not hold');
    }
  }
}
