import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { GalleryService } from './gallery.service.js';
import {
  galleryCategorySchema,
  galleryImageMetadataSchema,
  listCategoriesQuerySchema,
  listServicesQuerySchema,
  setGalleryQuotaOverrideSchema,
  updateGalleryCategorySchema,
  updateGalleryImageSchema,
} from './services.validation.js';
import { parseImageUpload, parseMultipartJsonField } from './services.upload.js';

const GALLERY_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export class GalleryController {
  constructor(private readonly service: GalleryService) {}

  async getQuota(request: FastifyRequest) {
    return { success: true, data: await this.service.getQuota(this.getSalonId(request)) };
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
    const data = galleryCategorySchema.parse(request.body);
    const result = await this.service.createCategory(
      this.getSalonId(request),
      this.getAccountId(request),
      data.categoryName,
      data.displayOrder
    );
    return reply.status(201).send({ success: true, data: result });
  }

  async updateCategory(request: FastifyRequest) {
    const data = updateGalleryCategorySchema.parse(request.body);
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

  async listImages(request: FastifyRequest) {
    const query = z.object({
      categoryId: z.string().uuid().optional(),
      ...listServicesQuerySchema.pick({ limit: true, offset: true }).shape,
    }).strict().parse(request.query);
    return {
      success: true,
      data: await this.service.listImages(
        this.getSalonId(request), query.categoryId, query.limit, query.offset
      ),
    };
  }

  async createImage(request: FastifyRequest, reply: FastifyReply) {
    const upload = await parseImageUpload(request, GALLERY_UPLOAD_MAX_BYTES);
    if (!upload.image) throw new ApiError(400, 'An image file is required');
    const metadata = galleryImageMetadataSchema.parse(
      parseMultipartJsonField(upload.fields, 'metadata')
    );
    const result = await this.service.createImage(
      this.getSalonId(request),
      this.getAccountId(request),
      upload.image,
      metadata
    );
    return reply.status(201).send({ success: true, data: result });
  }

  async updateImage(request: FastifyRequest) {
    const result = await this.service.updateImage(
      this.getSalonId(request),
      this.getImageId(request),
      this.getAccountId(request),
      updateGalleryImageSchema.parse(request.body)
    );
    return { success: true, data: result };
  }

  async archiveImage(request: FastifyRequest, reply: FastifyReply) {
    await this.service.updateImage(
      this.getSalonId(request),
      this.getImageId(request),
      this.getAccountId(request),
      { isActive: false }
    );
    return reply.status(204).send();
  }

  async listPublicImages(request: FastifyRequest) {
    const query = z.object({
      categoryId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    }).strict().parse(request.query);
    return {
      success: true,
      data: await this.service.listImages(
        this.getSalonId(request),
        query.categoryId,
        query.limit,
        query.offset,
        true
      ),
    };
  }

  async setQuotaOverride(request: FastifyRequest) {
    this.assertPlatformAdmin(request);
    const body = setGalleryQuotaOverrideSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.setQuotaOverride(
        this.getSalonId(request),
        this.getAccountId(request),
        {
          ...body,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        }
      ),
    };
  }

  private getSalonId(request: FastifyRequest) {
    return z.string().uuid().parse(requireRouteParam(request.params, 'salonId'));
  }

  private getCategoryId(request: FastifyRequest) {
    return z.string().uuid().parse(requireRouteParam(request.params, 'categoryId'));
  }

  private getImageId(request: FastifyRequest) {
    return z.string().uuid().parse(requireRouteParam(request.params, 'imageId'));
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
