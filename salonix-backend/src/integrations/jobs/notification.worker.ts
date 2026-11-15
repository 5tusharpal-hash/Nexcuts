import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../config/env.js';
import { prisma } from '../../bootstrap/db.connect.js';
import { logger } from '../../bootstrap/logger.js';
import { realtimeService, type RealtimeEvent } from '../realtime/realtime.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { QueueRepository } from '../../modules/queue/queue.repository.js';
import { EmailIntegration } from '../email/email.integration.js';
import { WhatsAppIntegration } from '../whatsapp/whatsapp.integration.js';

export interface NotificationJobData {
  eventId: string;
  accountId?: string;
  salonId?: string;
  title: string;
  body: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  channel?: string;
  metadata?: Prisma.InputJsonValue;
}

let connection: IORedis | null = null;
let notificationQueue: Queue<NotificationJobData> | null = null;
let notificationWorker: Worker<NotificationJobData> | null = null;

function redisConnection(): IORedis | null {
  if (!env.REDIS_URL) return null;
  connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

export function getNotificationQueue(): Queue<NotificationJobData> | null {
  const redis = redisConnection();
  if (!redis) return null;
  notificationQueue ??= new Queue<NotificationJobData>('salonix-notifications', { connection: redis });
  return notificationQueue;
}

export async function enqueueNotification(data: NotificationJobData): Promise<void> {
  const queue = getNotificationQueue();
  if (!queue) throw new Error('Notification queue requires REDIS_URL');
  await queue.add('deliver-notification', data, {
    jobId: data.eventId,
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5000 },
    removeOnFail: { age: 30 * 24 * 60 * 60, count: 10000 },
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
  });
}

export function startNotificationWorker(): Worker<NotificationJobData> | null {
  const redis = redisConnection();
  if (!redis || notificationWorker) return notificationWorker;

  notificationWorker = new Worker<NotificationJobData>('salonix-notifications', async (job) => {
    const data = job.data;
    if (data.eventId === 'queue-closing-expiry-maintenance') {
      await new QueueRepository().expireClosingRequests();
      return;
    }
    if (!data.accountId) return;
    const existingNotifications = await prisma.accountNotification.findMany({
      where: { accountId: data.accountId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    let notification = existingNotifications.find((item) =>
      (item.metadata as { deliveryKey?: string } | null)?.deliveryKey === data.eventId
    );
    if (!notification) {
      try {
        notification = await prisma.accountNotification.create({
          data: {
            deliveryKey: data.eventId,
            accountId: data.accountId,
            salonId: data.salonId ?? null,
            title: data.title,
            body: data.body,
            channel: data.channel ?? 'IN_APP',
            priority: data.priority,
            metadata: { ...((data.metadata ?? {}) as object), deliveryKey: data.eventId },
          },
        });
      } catch (error) {
        const recentNotifications = await prisma.accountNotification.findMany({
          where: { accountId: data.accountId }, orderBy: { createdAt: 'desc' }, take: 20,
        });
        const duplicate = recentNotifications.find((item) =>
          (item.metadata as { deliveryKey?: string } | null)?.deliveryKey === data.eventId
        );
        if (!duplicate) throw error;
        notification = duplicate;
      }
    }
    if (notification.status === 'SENT' || notification.status === 'READ') return;

    const account = await prisma.account.findUnique({
      where: { id: data.accountId },
      select: { email: true, phoneNumber: true },
    });
    try {
      if (notification.channel === 'EMAIL' && account?.email) {
        await new EmailIntegration().sendTransactionalEmail(account.email, data.title, data.body);
      } else if (notification.channel === 'WHATSAPP' && account?.phoneNumber) {
        await new WhatsAppIntegration().sendMessage({ to: account.phoneNumber, body: `${data.title}\n${data.body}` });
      } else if (notification.channel !== 'IN_APP') {
        throw new Error(`Notification channel ${notification.channel} has no provider or contact target configured`);
      }
      await prisma.accountNotification.update({
        where: { id: notification.id },
        data: { status: 'SENT' },
      });
    } catch (error) {
      const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 5) - 1;
      await prisma.accountNotification.update({
        where: { id: notification.id },
        data: {
          status: isFinalAttempt ? 'FAILED' : 'PENDING',
          metadata: {
            ...((data.metadata ?? {}) as object),
            deliveryKey: data.eventId,
            deliveryAttempt: job.attemptsMade + 1,
            deliveryError: error instanceof Error ? error.message : 'Delivery failed',
          },
        },
      });
      throw error;
    }

    const event: RealtimeEvent = {
      type: 'notification.received',
      salonId: data.salonId,
      userId: data.accountId,
      payload: { title: data.title, body: data.body, metadata: data.metadata ?? {} },
      occurredAt: new Date().toISOString(),
    };
    await realtimeService.publish(event);
  }, { connection: redis, concurrency: 10 });

  notificationWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, 'Notification worker delivery failed');
  });
  return notificationWorker;
}

export async function scheduleClosingExpiryMaintenance(): Promise<void> {
  const queue = getNotificationQueue();
  if (!queue) return;
  await queue.upsertJobScheduler('queue-closing-expiry-maintenance', { every: 60_000 }, {
    name: 'queue-closing-expiry-maintenance',
    data: {
      eventId: 'queue-closing-expiry-maintenance',
      title: 'Queue closing expiry maintenance',
      body: '',
      priority: 'LOW',
    },
  });
}

export async function closeNotificationJobs(): Promise<void> {
  await notificationWorker?.close();
  await notificationQueue?.close();
  if (connection) await connection.quit();
  notificationWorker = null;
  notificationQueue = null;
  connection = null;
}
