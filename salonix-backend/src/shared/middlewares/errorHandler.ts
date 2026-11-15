import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from '../errors/ApiError';
import { logger } from '../../bootstrap/logger.js';

function hasValidationDetails(error: unknown): error is Error & { validation: unknown } {
  return error instanceof Error && 'validation' in error;
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: { message: error.message, code: `HTTP_${error.statusCode}` },
      });
    }

    if (error instanceof ZodError || hasValidationDetails(error)) {
      return reply.status(400).send({
        success: false,
        error: { message: 'Request validation failed', code: 'VALIDATION_ERROR' },
      });
    }

    logger.error(
      { error: error instanceof Error ? error : new Error(String(error)), requestId: request.id },
      'Unhandled request error'
    );
    return reply.status(500).send({
      success: false,
      error: { message: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      error: { message: `Route ${request.method} ${request.url} not found`, code: 'NOT_FOUND' },
    });
  });
}
