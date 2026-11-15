import { Queue, Worker, type ConnectionOptions, type Processor } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../bootstrap/logger.js';

export interface BackgroundJob<T extends object> {
  name: string;
  payload: T;
  idempotencyKey: string;
}

export class BackgroundQueue<T extends object> {
  private connection: IORedis | null = null;
  private queue: Queue<BackgroundJob<T>> | null = null;
  private worker: Worker<BackgroundJob<T>> | null = null;

  constructor(private readonly name: string) {}

  private getConnection(): IORedis {
    if (!env.REDIS_URL) throw new Error(`REDIS_URL is required for queue "${this.name}"`);
    this.connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    return this.connection;
  }

  getQueue(): Queue<BackgroundJob<T>> {
    this.queue ??= new Queue<BackgroundJob<T>>(this.name, {
      connection: this.getConnection() as ConnectionOptions,
    });
    return this.queue;
  }

  async enqueue(job: BackgroundJob<T>, delayMs = 0): Promise<void> {
    await this.getQueue().add(job.name, job, {
      jobId: job.idempotencyKey,
      delay: delayMs,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
    });
  }

  start(processor: Processor<BackgroundJob<T>>, concurrency = 10): Worker<BackgroundJob<T>> {
    this.worker ??= new Worker<BackgroundJob<T>>(this.name, processor, {
      connection: this.getConnection() as ConnectionOptions,
      concurrency,
    });
    this.worker.on('failed', (job, error) => {
      logger.error({ queue: this.name, jobId: job?.id, error: error.message }, 'Background job failed');
    });
    return this.worker;
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    if (this.connection) await this.connection.quit();
    this.worker = null;
    this.queue = null;
    this.connection = null;
  }
}
