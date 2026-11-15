import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { ApiError } from '../../shared/errors/ApiError.js';
import { normalizeImage } from './image-processing.js';

test('image uploads are decoded and normalized to WebP within the configured limit', async () => {
  const png = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 12, g: 80, b: 145 },
    },
  }).png().toBuffer();
  const normalized = await normalizeImage(png, 2 * 1024 * 1024);
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(normalized.byteLength <= 2 * 1024 * 1024, true);
});

test('image uploads reject invalid data and normalized output exceeding the cap', async () => {
  await assert.rejects(
    normalizeImage(Buffer.from('not an image'), 1024),
    (error: unknown) => error instanceof ApiError && error.statusCode === 400
  );

  const png = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 250, g: 20, b: 190 },
    },
  }).png().toBuffer();
  await assert.rejects(
    normalizeImage(png, 1),
    (error: unknown) => error instanceof ApiError && error.statusCode === 413
  );
});
