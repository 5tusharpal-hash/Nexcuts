import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { logger } from '../../bootstrap/logger.js';

const SIGNED_URL_TTL_SECONDS = 15 * 60;

export class MediaStorage {
  private client: S3Client | undefined;

  async upload(key: string, body: Buffer): Promise<void> {
    const { client, bucket } = this.getStorage();
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
        CacheControl: 'private, max-age=300',
      }));
    } catch (error) {
      logger.error({ error, key }, 'Media object upload failed');
      throw new ApiError(502, 'Image storage upload failed');
    }
  }

  async createReadUrl(key: string): Promise<string> {
    const { client, bucket } = this.getStorage();
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
        { expiresIn: SIGNED_URL_TTL_SECONDS }
      );
    } catch (error) {
      logger.error({ error, key }, 'Media read URL generation failed');
      throw new ApiError(502, 'Image URL could not be generated');
    }
  }

  private getStorage(): { client: S3Client; bucket: string } {
    const {
      MEDIA_STORAGE_ENDPOINT: endpoint,
      MEDIA_STORAGE_REGION: region,
      MEDIA_STORAGE_BUCKET: bucket,
      MEDIA_STORAGE_ACCESS_KEY_ID: accessKeyId,
      MEDIA_STORAGE_SECRET_ACCESS_KEY: secretAccessKey,
    } = env;
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      throw new ApiError(503, 'Private image storage is not configured');
    }
    this.client ??= new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    return { client: this.client, bucket };
  }
}
