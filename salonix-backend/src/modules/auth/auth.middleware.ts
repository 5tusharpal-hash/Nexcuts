import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { ApiError } from '../../shared/errors/ApiError.js';

export class AuthMiddleware {
  private authService = new AuthService();

  async verifyToken(request: FastifyRequest, _reply: FastifyReply) {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new ApiError(401, 'Authentication token is missing or invalid');
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) throw new ApiError(401, 'Authentication token is missing or invalid');
    request.user = await this.authService.verifyToken(token);
  }
}
