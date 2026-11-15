import { randomUUID } from 'node:crypto';
import { ApiError } from '../../shared/errors/ApiError.js';
import { MediaStorage } from '../../integrations/object-storage/media-storage.js';
import { normalizeImage } from '../../integrations/object-storage/image-processing.js';
import { GalleryRepository } from './gallery.repository.js';
import type { GalleryImageResponse, SetGalleryQuotaOverrideRequest } from './services.types.js';

const GALLERY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export class GalleryService {
  constructor(
    private readonly repository = new GalleryRepository(),
    private readonly storage = new MediaStorage()
  ) {}

  getQuota(salonId: string) {
    return this.repository.getQuota(salonId);
  }

  listCategories(salonId: string, limit: number, offset: number) {
    return this.repository.listCategories(salonId, limit, offset);
  }

  createCategory(
    salonId: string,
    accountId: string,
    categoryName: string,
    displayOrder: number
  ) {
    return this.repository.createCategory(salonId, accountId, categoryName, displayOrder);
  }

  updateCategory(
    salonId: string,
    categoryId: string,
    accountId: string,
    data: { categoryName?: string; displayOrder?: number; isActive?: boolean }
  ) {
    return this.repository.updateCategory(salonId, categoryId, accountId, data);
  }

  archiveCategory(salonId: string, categoryId: string, accountId: string) {
    return this.repository.archiveCategory(salonId, categoryId, accountId);
  }

  async createImage(
    salonId: string,
    accountId: string,
    image: Buffer,
    metadata: {
      categoryId: string;
      altText?: string;
      isFeatured: boolean;
      displayOrder: number;
    }
  ) {
    const imageId = randomUUID();
    const objectKey = `salons/${salonId}/gallery/${imageId}.webp`;
    const normalized = await normalizeImage(image, GALLERY_IMAGE_MAX_BYTES);
    await this.storage.upload(objectKey, normalized);
    const row = await this.repository.createImage(
      imageId, salonId, accountId, objectKey, metadata
    );
    return this.toImageResponse(row);
  }

  async listImages(
    salonId: string,
    categoryId: string | undefined,
    limit: number,
    offset: number,
    publicOnly = false
  ) {
    const rows = publicOnly
      ? await this.repository.listPublicImages(salonId, categoryId, limit, offset)
      : await this.repository.listImages(salonId, categoryId, limit, offset);
    return Promise.all(rows.map((row) => this.toImageResponse(row)));
  }

  async updateImage(
    salonId: string,
    imageId: string,
    accountId: string,
    data: {
      categoryId?: string;
      altText?: string | null;
      isFeatured?: boolean;
      displayOrder?: number;
      isActive?: boolean;
    }
  ) {
    const row = await this.repository.updateImage(salonId, imageId, accountId, data);
    if (!row) throw new ApiError(404, 'Gallery image was not found');
    return this.toImageResponse(row);
  }

  setQuotaOverride(
    salonId: string,
    accountId: string,
    data: SetGalleryQuotaOverrideRequest
  ) {
    return this.repository.setQuotaOverride(salonId, accountId, data);
  }

  private async toImageResponse(
    row: {
      objectKey: string | null;
      legacyImageUrl: string | null;
    } & Omit<GalleryImageResponse, 'imageUrl'>
  ) {
    const { objectKey, legacyImageUrl, ...image } = row;
    const imageUrl = objectKey
      ? await this.storage.createReadUrl(objectKey)
      : legacyImageUrl;
    if (!imageUrl) throw new ApiError(500, 'Gallery image has no readable source');
    return {
      ...image,
      imageUrl,
    };
  }
}
