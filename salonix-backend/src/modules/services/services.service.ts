import { randomUUID } from 'node:crypto';
import { MediaStorage } from '../../integrations/object-storage/media-storage.js';
import { normalizeImage } from '../../integrations/object-storage/image-processing.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { ServicesRepository, type ServiceRow } from './services.repository.js';
import type {
  CreateSalonServiceRequest,
  CreateServiceCategoryRequest,
  ListServicesQuery,
  UpdateSalonServiceRequest,
  UpdateServiceCategoryRequest,
} from './services.types.js';

const SERVICE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export class ServicesService {
  constructor(
    private readonly repository = new ServicesRepository(),
    private readonly storage = new MediaStorage()
  ) {}

  async listServices(salonId: string, query: ListServicesQuery, publicOnly = false) {
    const rows = await this.repository.listServices(salonId, query, publicOnly);
    return Promise.all(rows.map((row) => this.toServiceResponse(row)));
  }

  async getService(salonId: string, serviceId: string, publicOnly = false) {
    const row = await this.repository.findService(salonId, serviceId, publicOnly);
    if (!row) throw new ApiError(404, 'Salon service was not found');
    return this.toServiceResponse(row);
  }

  async createService(
    salonId: string,
    accountId: string,
    data: CreateSalonServiceRequest,
    uploadedImage?: Buffer
  ) {
    if (uploadedImage && data.defaultImageId) {
      throw new ApiError(400, 'Choose either an uploaded image or a system default image');
    }
    const settings = await this.repository.getImageSettings();
    if (settings.serviceImageRequired && !uploadedImage && !data.defaultImageId) {
      throw new ApiError(400, 'A service image is required by platform settings');
    }
    const serviceId = randomUUID();
    const objectKey = uploadedImage
      ? `salons/${salonId}/services/${serviceId}.webp`
      : null;
    if (uploadedImage && objectKey) {
      const normalized = await normalizeImage(uploadedImage, SERVICE_IMAGE_MAX_BYTES);
      await this.storage.upload(objectKey, normalized);
    }
    const row = await this.repository.createService(
      serviceId, salonId, accountId, data, objectKey
    );
    if (!row) throw new ApiError(500, 'Created salon service could not be loaded');
    return this.toServiceResponse(row);
  }

  async updateService(
    salonId: string,
    serviceId: string,
    accountId: string,
    data: UpdateSalonServiceRequest
  ) {
    const row = await this.repository.updateService(salonId, serviceId, accountId, data);
    if (!row) throw new ApiError(404, 'Salon service was not found');
    return this.toServiceResponse(row);
  }

  archiveService(salonId: string, serviceId: string, accountId: string) {
    return this.repository.archiveService(salonId, serviceId, accountId);
  }

  async setServiceImage(
    salonId: string,
    serviceId: string,
    accountId: string,
    uploadedImage?: Buffer,
    defaultImageId?: string
  ) {
    if (Boolean(uploadedImage) === Boolean(defaultImageId)) {
      throw new ApiError(400, 'Provide exactly one uploaded image or default image ID');
    }
    if (uploadedImage) {
      const objectKey = `salons/${salonId}/services/${serviceId}.webp`;
      const normalized = await normalizeImage(uploadedImage, SERVICE_IMAGE_MAX_BYTES);
      await this.storage.upload(objectKey, normalized);
      const row = await this.repository.setServiceUploadedImage(
        salonId, serviceId, objectKey, accountId
      );
      if (!row) throw new ApiError(404, 'Salon service was not found');
      return this.toServiceResponse(row);
    }
    if (defaultImageId) {
      const row = await this.repository.setServiceDefaultImage(
        salonId, serviceId, defaultImageId, accountId
      );
      if (!row) throw new ApiError(404, 'Salon service was not found');
      return this.toServiceResponse(row);
    }
    throw new ApiError(400, 'Provide an uploaded image or default image ID');
  }

  async clearServiceImage(salonId: string, serviceId: string, accountId: string) {
    const row = await this.repository.clearServiceImage(salonId, serviceId, accountId);
    if (!row) throw new ApiError(404, 'Salon service was not found');
    return this.toServiceResponse(row);
  }

  listCategories(salonId: string, limit: number, offset: number) {
    return this.repository.listCategories(salonId, limit, offset);
  }

  createCategory(salonId: string, accountId: string, data: CreateServiceCategoryRequest) {
    return this.repository.createCategory(salonId, accountId, data);
  }

  updateCategory(
    salonId: string,
    categoryId: string,
    accountId: string,
    data: UpdateServiceCategoryRequest & { isActive?: boolean }
  ) {
    return this.repository.updateCategory(salonId, categoryId, accountId, data);
  }

  archiveCategory(salonId: string, categoryId: string, accountId: string) {
    return this.repository.archiveCategory(salonId, categoryId, accountId);
  }

  async listDefaultImages(categoryKey: string) {
    const rows = await this.repository.listDefaultImages(categoryKey);
    return Promise.all(rows.map(async (row) => ({
      id: row.id,
      categoryKey: row.categoryKey,
      altText: row.altText,
      imageUrl: await this.storage.createReadUrl(row.objectKey),
    })));
  }

  async createDefaultImage(
    accountId: string,
    categoryKey: string,
    altText: string | undefined,
    uploadedImage: Buffer
  ) {
    const defaultImageId = randomUUID();
    const objectKey = `system/service-defaults/${categoryKey}/${defaultImageId}.webp`;
    const normalized = await normalizeImage(uploadedImage, DEFAULT_IMAGE_MAX_BYTES);
    await this.storage.upload(objectKey, normalized);
    const row = await this.repository.createDefaultImage(
      defaultImageId, accountId, categoryKey, altText, objectKey
    );
    return {
      id: row.id,
      categoryKey: row.categoryKey,
      altText: row.altText,
      imageUrl: await this.storage.createReadUrl(row.objectKey),
    };
  }

  async updateDefaultImage(
    accountId: string,
    defaultImageId: string,
    data: { isActive?: boolean; altText?: string | null }
  ) {
    const row = await this.repository.updateDefaultImage(accountId, defaultImageId, data);
    return {
      id: row.id,
      categoryKey: row.categoryKey,
      altText: row.altText,
      isActive: row.isActive,
      imageUrl: await this.storage.createReadUrl(row.objectKey),
    };
  }

  getImageSettings() {
    return this.repository.getImageSettings();
  }

  updateImageSettings(accountId: string, required: boolean) {
    return this.repository.updateImageSettings(accountId, required);
  }

  private async toServiceResponse(row: ServiceRow) {
    const { imageKey, legacyImageUrl, ...service } = row;
    return {
      ...service,
      imageUrl: imageKey ? await this.storage.createReadUrl(imageKey) : legacyImageUrl,
    };
  }
}
