import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { env } from '../config/env.js';

const backendRoot = resolve(dirname(__dirname), '..');
const essentialTerminalMessages = new Set([
  'Fastify application initialized',
  'Server listening',
  'Graceful shutdown started',
]);

class DailyFileStream extends Writable {
  private currentDay: string | undefined;
  private destination: WriteStream | undefined;

  override _write(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    try {
      const day = new Date().toISOString().slice(0, 10);
      if (day !== this.currentDay) {
        this.destination?.end();
        const directory = resolve(backendRoot, 'logs');
        mkdirSync(directory, { recursive: true });
        this.destination = createWriteStream(resolve(directory, `${day}.log`), { flags: 'a' });
        this.destination.on('error', (error) => this.destroy(error));
        this.currentDay = day;
      }
      this.destination!.write(chunk, encoding, callback);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _final(callback: (error?: Error | null) => void) {
    if (!this.destination) {
      callback();
      return;
    }
    this.destination.end(callback);
  }
}

class EssentialTerminalStream extends Writable {
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    try {
      const entry = JSON.parse(chunk.toString()) as {
        level?: unknown;
        time?: unknown;
        msg?: unknown;
        err?: { message?: unknown; stack?: unknown };
      };
      const level = typeof entry.level === 'number' ? entry.level : 0;
      const message = typeof entry.msg === 'string' ? entry.msg : '';
      if (level < 40 && !essentialTerminalMessages.has(message)) {
        callback();
        return;
      }

      const timestamp =
        typeof entry.time === 'number' ? new Date(entry.time).toISOString() : '';
      const levelName = level >= 60 ? 'FATAL' : level >= 50 ? 'ERROR' : level >= 40 ? 'WARN' : 'INFO';
      const errorDetails =
        typeof entry.err?.stack === 'string'
          ? entry.err.stack
          : typeof entry.err?.message === 'string'
            ? entry.err.message
            : '';
      const output = `${timestamp} ${levelName} ${message}${errorDetails ? `\n${errorDetails}` : ''}\n`;
      process.stderr.write(output, callback);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

const level = env.NODE_ENV === 'development' ? 'debug' : 'info';
const streams = [
  { level: 'debug' as const, stream: new DailyFileStream() },
  { level: 'info' as const, stream: new EssentialTerminalStream() },
];

const pinoLogger =
  env.NODE_ENV === 'test'
    ? pino({ enabled: false, level })
    : pino(
        {
          level,
          redact: {
            paths: [
              'password',
              'password_hash',
              'token',
              'code',
              'otp',
              'authorization',
              'req.headers.authorization',
              'headers.authorization',
            ],
            censor: '[REDACTED]',
          },
        },
        pino.multistream(streams)
      );

export const logger: FastifyBaseLogger = pinoLogger;
