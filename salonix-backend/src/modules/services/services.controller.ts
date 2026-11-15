import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { ServicesService } from './services.service.js';
import {
  createServiceCategorySchema,
  createServiceSchema,
  defaultImageAdminMetadataSchema,
  defaultImagesQuerySchema,
  listCategoriesQuerySchema,
  listServicesQuerySchema,
  serviceImageSettingsSchema,
  updateDefaultImageSchema,
  updateServiceCategorySchema,
  updateServiceSchema,
} from './services.validation.js';
import { parseImageUpload, parseMultipartJsonField } from './services.upload.js';

const SERVICE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

export class ServicesController {
  constructor(private readonly service: ServicesService) {}

  async listPublic(request: FastifyRequest) {
    const salonId = this.getSalonId(request);
    const query = listServicesQuerySchema.parse(request.query);
    return {
      success: true,
      data: await this.service.listServices(
        salonId,
        { ...query, includeInactive: false },
        true
      ),
    };
  }

  async getPublic(request: FastifyRequest) {
    return {
      success: true,
      data: await this.service.getService(
        this.getSalonId(request),
        this.getServiceId(request),
        true
      ),
    };
  }

  async listCatalog(request: FastifyRequest) {
    const salonId = this.getSalonId(request);
    const query = listServicesQuerySchema.parse(request.query);
    return { success: true, data: await this.service.listServices(salonId, query) };
  }

  async create(request: FastifyRequest, reply: FastifyReply) {
    const accountId = this.getAccountId(request);
    const salonId = this.getSalonId(request);
    const upload = await parseImageUpload(request, SERVICE_UPLOAD_MAX_BYTES, false);
    const metadata = createServiceSchema.parse(
      parseMultipartJsonField(upload.fields, 'service')
    );
    const result = await this.service.createService(
      salonId,
      accountId,
      metadata,
      upload.image
    );
    return reply.status(201).send({ success: true, data: result });
  }

  async update(request: FastifyRequest) {
    const data = updateServiceSchema.parse(request.body);
    const result = await this.service.updateService(
      this.getSalonId(request),
      this.getServiceId(request),
      this.getAccountId(request),
      data
    );
    return { success: true, data: result };
  }

  async archive(request: FastifyRequest, reply: FastifyReply) {
    await this.service.archiveService(
      this.getSalonId(request),
      this.getServiceId(request),
      this.getAccountId(request)
    );
    return reply.status(204).send();
  }

  async setImage(request: FastifyRequest) {
    const upload = await parseImageUpload(request, SERVICE_UPLOAD_MAX_BYTES, false);
    const defaultImageId = upload.fields.defaultImageId
      ? z.string().uuid().parse(upload.fields.defaultImageId)
      : undefined;
    if (Object.keys(upload.fields).some((key) => key !== 'defaultImageId')) {
      throw new ApiError(400, 'Only defaultImageId is allowed with the image upload');
    }
    const result = await this.service.setServiceImage(
      this.getSalonId(request),
      this.getServiceId(request),
      this.getAccountId(request),
      upload.image,
      defaultImageId
    );
    return { success: true, data: result };
  }

  async clearImage(request: FastifyRequest) {
    const result = await this.service.clearServiceImage(
      this.getSalonId(request),
      this.getServiceId(request),
      this.getAccountId(request)
    );
    return { success: true, data: result };
  }

  async listCategories(request: FastifyRequest) {
    const query = listCategoriesQuerySchema.parse(request.query);
    return {
      success: true,
      data: await this.service.listCategories(
        this.getSalonId(request), query.limit, query.offset
      ),
    };
  }

  async createCategory(request: FastifyRequest, reply: FastifyReply) {
    const data = createServiceCategorySchema.parse(request.body);
    const result = await this.service.createCategory(
      this.getSalonId(request), this.getAccountId(request), data
    );
    return reply.status(201).send({ success: true, data: result });
  }

  async updateCategory(request: FastifyRequest) {
    const data = updateServiceCategorySchema.parse(request.body);
    const result = await this.service.updateCategory(
      this.getSalonId(request),
      this.getCategoryId(request),
      this.getAccountId(request),
      data
    );
    return { success: true, data: result };
  }

  async archiveCategory(request: FastifyRequest, reply: FastifyReply) {
    await this.service.archiveCategory(
      this.getSalonId(request),
      this.getCategoryId(request),
      this.getAccountId(request)
    );
    return reply.status(204).send();
  }

  async listDefaultImages(request: FastifyRequest) {
    const { categoryKey } = defaultImagesQuerySchema.parse(request.query);
    return { success: true, data: await this.service.listDefaultImages(categoryKey) };
  }

  async getImageSettings(request: FastifyRequest) {
    this.assertPlatformAdmin(request);
    return { success: true, data: await this.service.getImageSettings() };
  }

  async updateImageSettings(request: FastifyRequest) {
    this.assertPlatformAdmin(request);
    const { serviceImageRequired } = serviceImageSettingsSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.updateImageSettings(this.getAccountId(request), serviceImageRequired),
    };
  }

  async createDefaultImage(request: FastifyRequest, reply: FastifyReply) {
    this.assertPlatformAdmin(request);
    const upload = await parseImageUpload(request, SERVICE_UPLOAD_MAX_BYTES);
    if (!upload.image) throw new ApiError(400, 'An image file is required');
    const metadata = defaultImageAdminMetadataSchema.parse({
      categoryKey: upload.fields.categoryKey,
      ...(upload.fields.altText ? { altText: upload.fields.altText } : {}),
    });
    if (Object.keys(upload.fields).some((key) => !['categoryKey', 'altText'].includes(key))) {
      throw new ApiError(400, 'Only categoryKey and altText fields are accepted');
    }
    const result = await this.service.createDefaultImage(
      this.getAccountId(request),
      metadata.categoryKey,
      metadata.altText,
      upload.image
    );
    return reply.status(201).send({ success: true, data: result });
  }

  async updateDefaultImage(request: FastifyRequest) {
    this.assertPlatformAdmin(request);
    const defaultImageId = z.string().uuid().parse(
      (request.params as Record<string, unknown>).defaultImageId
    );
    const data = updateDefaultImageSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.updateDefaultImage(
        this.getAccountId(request), defaultImageId, data
      ),
    };
  }

  private getSalonId(request: FastifyRequest) {
    return z.string().uuid().parse(requireRouteParam(request.params, 'salonId'));
  }

  private getServiceId(request: FastifyRequest) {
    return z.string().uuid().parse(requireRouteParam(request.params, 'serviceId'));
  }

  private getCategoryId(request: FastifyRequest) {
    return z.string().uuid().parse(requireRouteParam(request.params, 'categoryId'));
  }

  private getAccountId(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    return request.user.id;
  }

  private assertPlatformAdmin(request: FastifyRequest) {
    if (
      request.user?.account_type !== 'ADMIN' ||
      !request.user.is_super_admin
    ) {
      throw new ApiError(403, 'Platform administrator access is required');
    }
  }
}
