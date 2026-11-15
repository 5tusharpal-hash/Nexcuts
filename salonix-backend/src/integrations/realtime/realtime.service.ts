import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { AuthService } from '../../modules/auth/auth.service.js';
import { prisma } from '../../bootstrap/db.connect.js';
import { env } from '../../config/env.js';
import { logger } from '../../bootstrap/logger.js';

export interface RealtimeEvent {
  type: string;
  salonId?: string;
  userId?: string;
  payload: unknown;
  occurredAt: string;
}

export class RealtimeService {
  private io: SocketServer | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private readonly authService = new AuthService();

  async initialize(server: HttpServer): Promise<void> {
    this.io = new SocketServer(server, {
      cors: { origin: env.CORS_ORIGINS, credentials: true },
      transports: ['websocket', 'polling'],
    });

    if (env.REDIS_URL) {
      this.pubClient = new Redis(env.REDIS_URL);
      this.subClient = this.pubClient.duplicate();
      this.io.adapter(createAdapter(this.pubClient, this.subClient));
    }

    this.io.use(async (socket, next) => {
      try {
        const token = this.getToken(socket.handshake.auth?.token, socket.handshake.headers.authorization);
        if (!token) return next(new Error('Authentication required'));
        socket.data.user = await this.authService.verifyToken(token);
        next();
      } catch (error) {
        next(error instanceof Error ? error : new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket) => {
      const user = socket.data.user as Awaited<ReturnType<AuthService['verifyToken']>>;
      void socket.join(`user:${user.id}`);

      socket.on('join:salon', async (salonId: unknown, acknowledge) => {
        const canJoin = typeof salonId === 'string' && await this.canJoinSalon(user.id, salonId, user.is_super_admin);
        if (!canJoin) {
          acknowledge?.({ success: false, error: 'FORBIDDEN' });
          return;
        }
        await socket.join(`salon:${salonId}`);
        acknowledge?.({ success: true });
      });

      socket.on('leave:salon', async (salonId: unknown) => {
        if (typeof salonId === 'string') await socket.leave(`salon:${salonId}`);
      });
    });

    logger.info('Realtime Socket.IO server initialized');
  }

  async publish(event: RealtimeEvent): Promise<void> {
    if (!this.io) return;
    if (event.salonId) this.io.to(`salon:${event.salonId}`).emit(event.type, event);
    if (event.userId) this.io.to(`user:${event.userId}`).emit(event.type, event);
  }

  async close(): Promise<void> {
    await this.io?.close();
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
    this.pubClient = null;
    this.subClient = null;
    this.io = null;
  }

  private getToken(authToken: unknown, authorization: unknown): string | null {
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim().replace(/^Bearer\s+/i, '');
    if (typeof authorization !== 'string') return null;
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    return match?.[1]?.trim() ?? null;
  }

  private async canJoinSalon(userId: string, salonId: string, isSuperAdmin: boolean): Promise<boolean> {
    if (isSuperAdmin) return true;
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { organizationId: true },
    });
    if (!salon) return false;
    const membership = await prisma.salonMembership.findFirst({
      where: { organizationId: salon.organizationId, accountId: userId, status: 'ACTIVE' },
      select: { id: true },
    });
    return Boolean(membership);
  }
}

export const realtimeService = new RealtimeService();
