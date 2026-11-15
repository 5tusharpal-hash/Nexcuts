import 'dotenv/config';
import { buildApp } from './bootstrap/app.js';
import { env } from './config/env.js';
import { connectDb, connectRedis } from './bootstrap/db.connect.js';
import { logger } from './bootstrap/logger.js';
import { realtimeService } from './integrations/realtime/realtime.service.js';
import { closeNotificationJobs, scheduleClosingExpiryMaintenance, startNotificationWorker } from './integrations/jobs/notification.worker.js';
import { QueueRepository } from './modules/queue/queue.repository.js';
import { dispatchDueMarketingCampaigns } from './integrations/jobs/marketing.scheduler.js';

let marketingScheduler: NodeJS.Timeout | null = null;

async function startServer() {
  const app = await buildApp();
  try {
    await connectRedis();
    await connectDb();
    await realtimeService.initialize(app.server);
    const queueRepository = new QueueRepository();
    await queueRepository.expireClosingRequests();
    await scheduleClosingExpiryMaintenance();
    await dispatchDueMarketingCampaigns();
    startNotificationWorker();
    marketingScheduler = setInterval(() => {
      void dispatchDueMarketingCampaigns().catch((error: unknown) => {
        logger.error({ error }, 'Marketing scheduler failed');
      });
    }, 60_000);
    marketingScheduler.unref();
    await app.listen({ host: env.HOST, port: env.PORT });
    logger.info({ host: env.HOST, port: env.PORT }, 'Server listening');
  } catch (error) {
    if (marketingScheduler) clearInterval(marketingScheduler);

    const cleanupTasks = [
      ['realtime service', () => realtimeService.close()],
      ['notification jobs', () => closeNotificationJobs()],
      ['Fastify application', () => app.close()],
    ] as const;

    for (const [resource, cleanup] of cleanupTasks) {
      try {
        await cleanup();
      } catch (cleanupError) {
        logger.error(
          { error: cleanupError, resource },
          'Startup cleanup failed',
        );
      }
    }

    throw error;
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');
    if (marketingScheduler) clearInterval(marketingScheduler);
    await realtimeService.close();
    await closeNotificationJobs();
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Graceful shutdown timed out')), 10_000);
        timer.unref();
      }),
    ]);
    process.exitCode = 0;
  };
  process.once('SIGINT', () => void shutdown('SIGINT').catch((error: unknown) => {
    logger.error({ error }, 'Shutdown failed');
    process.exitCode = 1;
  }));
  process.once('SIGTERM', () => void shutdown('SIGTERM').catch((error: unknown) => {
    logger.error({ error }, 'Shutdown failed');
    process.exitCode = 1;
  }));
}

void startServer().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Server startup failed');
  process.exitCode = 1;
});
