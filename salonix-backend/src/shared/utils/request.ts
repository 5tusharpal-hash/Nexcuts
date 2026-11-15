import { ApiError } from '../errors/ApiError.js';

export function readRouteParam(params: unknown, name: string): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const value = (params as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function requireRouteParam(params: unknown, name: string): string {
  const value = readRouteParam(params, name);
  if (!value) {
    throw new ApiError(400, `Route parameter ${name} is required`);
  }

  return value;
}
