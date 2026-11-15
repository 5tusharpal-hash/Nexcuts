import type { preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { RbacService } from './rbac.service';
import { ApiError } from '../../shared/errors/ApiError.js';
import { readRouteParam } from '../../shared/utils/request.js';

export class RbacMiddleware {
  private rbacService = new RbacService();

  check(permission: string): preHandlerHookHandler {
    return async (request) => {
      if (!request.user) throw new ApiError(401, 'Authentication required');
      if (request.user.account_type !== 'SALON' && !request.user.is_super_admin) {
        throw new ApiError(403, 'A salon account is required for this permission');
      }

      const salonId =
        readRouteParam(request.params, 'salonId') ??
        (typeof request.headers['x-salon-id'] === 'string'
          ? request.headers['x-salon-id']
          : undefined);
      if (!salonId) throw new ApiError(400, 'Salon ID is required for permission check');
      const validatedSalonId = z.string().uuid().parse(salonId);

      const { permissions } = await this.rbacService.getEffectivePermissions(
        request.user.id,
        validatedSalonId
      );
      if (request.user.is_super_admin || permissions.includes(permission)) return;

      throw new ApiError(403, `Forbidden: Missing required permission [${permission}]`);
    };
  }
}
