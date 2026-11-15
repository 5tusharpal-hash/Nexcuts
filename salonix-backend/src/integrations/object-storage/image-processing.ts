import sharp from 'sharp';
import { ApiError } from '../../shared/errors/ApiError.js';

const MAX_INPUT_PIXELS = 20_000_000;
const MAX_DIMENSION = 3_200;

export async function normalizeImage(
  input: Buffer,
  maxBytes: number
): Promise<Buffer> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    }).metadata();
  } catch {
    throw new ApiError(400, 'The uploaded file is not a valid supported image');
  }

  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) {
    throw new ApiError(400, 'Only JPEG, PNG, and WebP images are supported');
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new ApiError(400, 'Animated and multi-page images are not supported');
  }
  if (!metadata.width || !metadata.height) {
    throw new ApiError(400, 'The uploaded image has invalid dimensions');
  }

  for (const quality of [82, 65, 48]) {
    try {
      const output = await sharp(input, {
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
        animated: false,
      })
        .rotate()
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality, effort: 4 })
        .toBuffer();
      if (output.byteLength <= maxBytes) return output;
    } catch {
      throw new ApiError(400, 'The uploaded file could not be processed as an image');
    }
  }
  throw new ApiError(413, 'The processed image exceeds the allowed file size');
}
