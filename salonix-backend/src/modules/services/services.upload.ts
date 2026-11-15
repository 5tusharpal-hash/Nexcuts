import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/ApiError.js';

export interface ParsedImageUpload {
  image?: Buffer;
  fields: Record<string, string>;
}

export async function parseImageUpload(
  request: FastifyRequest,
  maxFileSize: number,
  imageRequired = true
): Promise<ParsedImageUpload> {
  const fields: Record<string, string> = {};
  let image: Buffer | undefined;

  try {
    for await (const part of request.parts({
      limits: { files: 1, fileSize: maxFileSize, fields: 4, parts: 5 },
    })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'image' || image) {
          throw new ApiError(400, 'Provide exactly one file using the image field');
        }
        try {
          image = await part.toBuffer();
        } catch {
          throw new ApiError(413, 'Image exceeds the allowed upload size');
        }
      } else {
        if (part.fieldname === 'image') {
          throw new ApiError(400, 'The image field must contain a file');
        }
        if (Object.hasOwn(fields, part.fieldname)) {
          throw new ApiError(400, `Multipart field ${part.fieldname} must not repeat`);
        }
        if (typeof part.value !== 'string') {
          throw new ApiError(400, `Multipart field ${part.fieldname} must be text`);
        }
        fields[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Multipart image request is malformed');
  }

  if (imageRequired && !image?.byteLength) throw new ApiError(400, 'An image file is required');
  if (image && image.byteLength > maxFileSize) {
    throw new ApiError(413, 'Image exceeds the allowed upload size');
  }
  return { image, fields };
}

export function parseMultipartJsonField(
  fields: Record<string, string>,
  fieldName: string
): unknown {
  const value = fields[fieldName];
  if (!value) throw new ApiError(400, `Multipart field ${fieldName} is required`);
  try {
    return JSON.parse(value);
  } catch {
    throw new ApiError(400, `Multipart field ${fieldName} must contain valid JSON`);
  }
}
