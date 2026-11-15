import type { PoolClient } from 'pg';
import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
  CreateSalonServiceRequest,
  CreateServiceCategoryRequest,
  SalonServiceResponse,
  ServiceCategoryResponse,
  ServiceImageSettingsResponse,
  ListServicesQuery,
  UpdateSalonServiceRequest,
  UpdateServiceCategoryRequest,
} from './services.types.js';

export interface ServiceRow extends Omit<SalonServiceResponse, 'imageUrl'> {
  imageKey: string | null;
  legacyImageUrl: string | null;
}

interface ServiceDefaultImageRow {
  id: string;
  categoryKey: string;
  altText: string | null;
  objectKey: string;
}

export class ServicesRepository {
  async listServices(salonId: string, query: ListServicesQuery, publicOnly = false) {
    const sortColumns = {
      name: 'service.name',
      price: 'service.base_price',
      duration: 'service.estimated_duration_minutes',
      createdAt: 'service.created_at',
    } as const;
    const result = await db.query<ServiceRow>(
      `SELECT service.id,
              service.salon_id AS "salonId",
              service.category_id AS "categoryId",
              category.name AS "categoryName",
              service.name,
              service.description,
              service.estimated_duration_minutes AS "estimatedDurationMinutes",
              service.base_price::text AS "basePrice",
              service.target_audience AS "targetAudience",
              service.default_image_id AS "defaultImageId",
              service.is_public AS "isPublic",
              service.is_active AS "isActive",
              service.created_at AS "createdAt",
              service.updated_at AS "updatedAt",
              service.image_url AS "legacyImageUrl",
              COALESCE(default_image.object_key, service.image_object_key) AS "imageKey"
       FROM salon_services AS service
       LEFT JOIN salon_service_categories AS category
         ON category.id = service.category_id AND category.salon_id = service.salon_id
       LEFT JOIN salon_service_default_images AS default_image
         ON default_image.id = service.default_image_id
       WHERE service.salon_id = $1
         AND service.deleted_at IS NULL
         AND ($2::boolean = FALSE OR (service.is_active = TRUE AND service.is_public = TRUE))
         AND ($2::boolean = FALSE OR EXISTS (
           SELECT 1 FROM salons AS approved_salon
           JOIN salon_applications AS application
             ON application.salon_id = approved_salon.id
           WHERE approved_salon.id = service.salon_id
             AND approved_salon.status = 'ACTIVE'
             AND approved_salon.deleted_at IS NULL
             AND application.status = 'APPROVED'
         ))
         AND ($3::boolean = TRUE OR service.is_active = TRUE)
         AND ($4::uuid IS NULL OR service.category_id = $4)
         AND ($5::varchar IS NULL OR service.target_audience = $5)
         AND ($6::varchar IS NULL OR
              service.name ILIKE '%' || $6 || '%' OR
              COALESCE(service.description, '') ILIKE '%' || $6 || '%')
       ORDER BY ${sortColumns[query.sortBy]} ${query.sortDirection.toUpperCase()}, service.id
       LIMIT $7 OFFSET $8`,
      [
        salonId,
        publicOnly,
        query.includeInactive,
        query.categoryId ?? null,
        query.targetAudience ?? null,
        query.search ?? null,
        query.limit,
        query.offset,
      ]
    );
    return result.rows;
  }

  async findService(salonId: string, serviceId: string, publicOnly = false) {
    const result = await db.query<ServiceRow>(
      `SELECT service.id,
              service.salon_id AS "salonId",
              service.category_id AS "categoryId",
              category.name AS "categoryName",
              service.name,
              service.description,
              service.estimated_duration_minutes AS "estimatedDurationMinutes",
              service.base_price::text AS "basePrice",
              service.target_audience AS "targetAudience",
              service.default_image_id AS "defaultImageId",
              service.is_public AS "isPublic",
              service.is_active AS "isActive",
              service.created_at AS "createdAt",
              service.updated_at AS "updatedAt",
              service.image_url AS "legacyImageUrl",
              COALESCE(default_image.object_key, service.image_object_key) AS "imageKey"
       FROM salon_services AS service
       LEFT JOIN salon_service_categories AS category
         ON category.id = service.category_id AND category.salon_id = service.salon_id
       LEFT JOIN salon_service_default_images AS default_image
         ON default_image.id = service.default_image_id
       WHERE service.salon_id = $1 AND service.id = $2
         AND service.deleted_at IS NULL
         AND ($3::boolean = FALSE OR (service.is_active = TRUE AND service.is_public = TRUE))
         AND ($3::boolean = FALSE OR EXISTS (
           SELECT 1 FROM salons AS approved_salon
           JOIN salon_applications AS application
             ON application.salon_id = approved_salon.id
           WHERE approved_salon.id = service.salon_id
             AND approved_salon.status = 'ACTIVE'
             AND approved_salon.deleted_at IS NULL
             AND application.status = 'APPROVED'
         ))`,
      [salonId, serviceId, publicOnly]
    );
    return result.rows[0] ?? null;
  }

  async getImageSettings(): Promise<ServiceImageSettingsResponse> {
    const result = await db.query<{ serviceImageRequired: boolean }>(
      `SELECT service_image_required AS "serviceImageRequired"
       FROM platform_service_image_settings WHERE id = TRUE`
    );
    return { serviceImageRequired: result.rows[0]?.serviceImageRequired ?? false };
  }

  async createService(
    serviceId: string,
    salonId: string,
    accountId: string,
    data: CreateSalonServiceRequest,
    imageObjectKey: string | null
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const salon = await client.query(
        `SELECT salon.organization_id
         FROM salons AS salon
         JOIN salon_applications AS application ON application.salon_id = salon.id
         WHERE salon.id = $1 AND salon.status = 'ACTIVE'
           AND salon.deleted_at IS NULL AND application.status = 'APPROVED'
         FOR UPDATE OF salon`,
        [salonId]
      );
      if (!salon.rows[0]) throw new ApiError(404, 'Approved salon was not found');
      await this.assertServiceImageChoice(
        client, salonId, data.categoryId, data.defaultImageId, imageObjectKey
      );
      const setting = await client.query(
        'SELECT service_image_required FROM platform_service_image_settings WHERE id = TRUE'
      );
      if (
        setting.rows[0]?.service_image_required &&
        !imageObjectKey &&
        !data.defaultImageId
      ) {
        throw new ApiError(400, 'A service image is required by platform settings');
      }
      await client.query(
        `INSERT INTO salon_services (
           id, salon_id, category_id, name, description,
           estimated_duration_minutes, base_price, target_audience,
           is_public, is_active, image_object_key, default_image_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          serviceId,
          salonId,
          data.categoryId ?? null,
          data.name,
          data.description ?? null,
          data.estimatedDurationMinutes,
          data.basePrice,
          data.targetAudience,
          data.isPublic,
          data.isActive,
          imageObjectKey,
          data.defaultImageId ?? null,
        ]
      );
      await this.writeAudit(client, accountId, salon.rows[0].organization_id, salonId,
        'SALON_SERVICE_CREATED', serviceId, data);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw mapUniqueViolation(error, 'A service with this name already exists in this salon');
    } finally {
      client.release();
    }
    return this.findService(salonId, serviceId);
  }

  async updateService(
    salonId: string,
    serviceId: string,
    accountId: string,
    data: UpdateSalonServiceRequest
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT salon.organization_id, service.category_id, service.default_image_id,
                service.image_object_key, service.is_active
         FROM salon_services AS service
         JOIN salons AS salon ON salon.id = service.salon_id
         WHERE service.salon_id = $1 AND service.id = $2
           AND service.deleted_at IS NULL AND salon.status = 'ACTIVE'
         FOR UPDATE OF service`,
        [salonId, serviceId]
      );
      const row = current.rows[0];
      if (!row) throw new ApiError(404, 'Salon service was not found');
      const categoryId = data.categoryId === undefined ? row.category_id : data.categoryId;
      const defaultImageId = row.default_image_id as string | null;
      await this.assertServiceImageChoice(
        client,
        salonId,
        categoryId as string | null,
        defaultImageId ?? undefined,
        row.image_object_key as string | null
      );
      if (data.isActive === true) {
        const setting = await client.query(
          'SELECT service_image_required FROM platform_service_image_settings WHERE id = TRUE'
        );
        if (setting.rows[0]?.service_image_required &&
            !row.image_object_key && !defaultImageId) {
          throw new ApiError(409, 'A service image is required before activating this service');
        }
      }

      const columns: Record<string, string> = {
        categoryId: 'category_id',
        name: 'name',
        description: 'description',
        estimatedDurationMinutes: 'estimated_duration_minutes',
        basePrice: 'base_price',
        targetAudience: 'target_audience',
        isPublic: 'is_public',
        isActive: 'is_active',
      };
      const values: unknown[] = [serviceId, salonId];
      const assignments = Object.entries(data).map(([key, value]) => {
        values.push(value);
        return `${columns[key]} = $${values.length}`;
      });
      assignments.push('updated_at = CURRENT_TIMESTAMP');
      await client.query(
        `UPDATE salon_services SET ${assignments.join(', ')}
         WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL`,
        values
      );
      await this.writeAudit(client, accountId, row.organization_id, salonId,
        'SALON_SERVICE_UPDATED', serviceId, data);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw mapUniqueViolation(error, 'A service with this name already exists in this salon');
    } finally {
      client.release();
    }
    return this.findService(salonId, serviceId);
  }

  async archiveService(salonId: string, serviceId: string, accountId: string): Promise<void> {
    const result = await db.query(
      `WITH archived AS (
         UPDATE salon_services AS service
         SET deleted_at = CURRENT_TIMESTAMP, is_active = FALSE, updated_at = CURRENT_TIMESTAMP
         FROM salons AS salon
         WHERE service.salon_id = $1 AND service.id = $2
           AND service.salon_id = salon.id AND service.deleted_at IS NULL
         RETURNING service.id, salon.organization_id
       )
       INSERT INTO audit_logs (
         actor_account_id, actor_context, organization_id, salon_id,
         action, resource_type, resource_id, changes
       )
       SELECT $3, 'SALON', archived.organization_id, $1,
              'SALON_SERVICE_ARCHIVED', 'SALON_SERVICE', archived.id, '{}'::jsonb
       FROM archived
       RETURNING resource_id`,
      [salonId, serviceId, accountId]
    );
    if (!result.rowCount) throw new ApiError(404, 'Salon service was not found');
  }

  async setServiceDefaultImage(
    salonId: string,
    serviceId: string,
    defaultImageId: string,
    accountId: string
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const service = await client.query(
        `SELECT service.category_id, salon.organization_id
         FROM salon_services AS service
         JOIN salons AS salon ON salon.id = service.salon_id
         WHERE service.salon_id = $1 AND service.id = $2 AND service.deleted_at IS NULL
         FOR UPDATE OF service`,
        [salonId, serviceId]
      );
      if (!service.rows[0]) throw new ApiError(404, 'Salon service was not found');
      await this.assertServiceImageChoice(
        client, salonId, service.rows[0].category_id, defaultImageId, null
      );
      await client.query(
        `UPDATE salon_services
         SET default_image_id = $3, image_object_key = NULL, image_url = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE salon_id = $1 AND id = $2`,
        [salonId, serviceId, defaultImageId]
      );
      await this.writeAudit(client, accountId, service.rows[0].organization_id, salonId,
        'SALON_SERVICE_DEFAULT_IMAGE_SET', serviceId, { defaultImageId });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.findService(salonId, serviceId);
  }

  async setServiceUploadedImage(
    salonId: string,
    serviceId: string,
    imageObjectKey: string,
    accountId: string
  ) {
    const result = await db.query(
      `WITH updated AS (
         UPDATE salon_services AS service
         SET image_object_key = $3, image_url = NULL, default_image_id = NULL,
             updated_at = CURRENT_TIMESTAMP
         FROM salons AS salon
         WHERE service.salon_id = $1 AND service.id = $2
           AND service.salon_id = salon.id AND service.deleted_at IS NULL
         RETURNING service.id, salon.organization_id
       )
       INSERT INTO audit_logs (
         actor_account_id, actor_context, organization_id, salon_id,
         action, resource_type, resource_id, changes
       )
       SELECT $4, 'SALON', updated.organization_id, $1,
              'SALON_SERVICE_IMAGE_UPLOADED', 'SALON_SERVICE', updated.id, '{}'::jsonb
       FROM updated
       RETURNING resource_id`,
      [salonId, serviceId, imageObjectKey, accountId]
    );
    if (!result.rowCount) throw new ApiError(404, 'Salon service was not found');
    return this.findService(salonId, serviceId);
  }

  async clearServiceImage(salonId: string, serviceId: string, accountId: string) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const service = await client.query(
        `SELECT salon.organization_id, service.image_object_key
         FROM salon_services AS service
         JOIN salons AS salon ON salon.id = service.salon_id
         WHERE service.salon_id = $1 AND service.id = $2
           AND service.deleted_at IS NULL
         FOR UPDATE OF service`,
        [salonId, serviceId]
      );
      if (!service.rows[0]) throw new ApiError(404, 'Salon service was not found');
      const setting = await client.query(
        'SELECT service_image_required FROM platform_service_image_settings WHERE id = TRUE'
      );
      if (setting.rows[0]?.service_image_required) {
        throw new ApiError(409, 'Service images are required by platform settings');
      }
      await client.query(
        `UPDATE salon_services
         SET image_object_key = NULL, image_url = NULL, default_image_id = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE salon_id = $1 AND id = $2`,
        [salonId, serviceId]
      );
      await this.writeAudit(client, accountId, service.rows[0].organization_id, salonId,
        'SALON_SERVICE_IMAGE_CLEARED', serviceId, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.findService(salonId, serviceId);
  }

  async listCategories(salonId: string, limit: number, offset: number) {
    const result = await db.query<ServiceCategoryResponse>(
      `SELECT category.id, category.salon_id AS "salonId", category.name,
              category.description,
              category.default_image_category_key AS "defaultImageCategoryKey",
              category.display_order AS "displayOrder", category.is_active AS "isActive",
              COUNT(service.id)::integer AS "serviceCount"
       FROM salon_service_categories AS category
       LEFT JOIN salon_services AS service
         ON service.category_id = category.id AND service.deleted_at IS NULL
       WHERE category.salon_id = $1
       GROUP BY category.id
       ORDER BY category.display_order, category.name
       LIMIT $2 OFFSET $3`,
      [salonId, limit, offset]
    );
    return result.rows;
  }

  async createCategory(
    salonId: string,
    accountId: string,
    data: CreateServiceCategoryRequest
  ) {
    let result;
    try {
      result = await db.query<ServiceCategoryResponse>(
        `WITH created AS (
         INSERT INTO salon_service_categories (
           salon_id, name, description, default_image_category_key, display_order
         )
         SELECT $1, $2, $3, $4, $5
         FROM salons WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
         RETURNING id, salon_id, name, description, default_image_category_key,
                   display_order, is_active
       ),
       audited AS (
         INSERT INTO audit_logs (
           actor_account_id, actor_context, organization_id, salon_id,
           action, resource_type, resource_id, changes
         )
         SELECT $6, 'SALON', salon.organization_id, $1,
                'SALON_SERVICE_CATEGORY_CREATED', 'SALON_SERVICE_CATEGORY',
                created.id, jsonb_build_object('name', created.name)
         FROM created JOIN salons AS salon ON salon.id = created.salon_id
       )
       SELECT created.id, created.salon_id AS "salonId", created.name,
              created.description,
              created.default_image_category_key AS "defaultImageCategoryKey",
              created.display_order AS "displayOrder", created.is_active AS "isActive",
              0 AS "serviceCount"
       FROM created`,
        [salonId, data.name, data.description ?? null,
          data.defaultImageCategoryKey ?? null, data.displayOrder, accountId]
      );
    } catch (error) {
      throw mapUniqueViolation(error, 'A service category with this name already exists');
    }
    if (!result.rows[0]) throw new ApiError(404, 'Active salon was not found');
    return result.rows[0];
  }

  async updateCategory(
    salonId: string,
    categoryId: string,
    accountId: string,
    data: UpdateServiceCategoryRequest & { isActive?: boolean }
  ) {
    const columns: Record<string, string> = {
      name: 'name',
      description: 'description',
      defaultImageCategoryKey: 'default_image_category_key',
      displayOrder: 'display_order',
      isActive: 'is_active',
    };
    const values: unknown[] = [salonId, categoryId, accountId];
    const assignments = Object.entries(data).map(([key, value]) => {
      values.push(value);
      return `${columns[key]} = $${values.length}`;
    });
    let result;
    try {
      result = await db.query(
        `WITH updated AS (
         UPDATE salon_service_categories AS category
         SET ${assignments.join(', ')}
         FROM salons AS salon
         WHERE category.salon_id = $1 AND category.id = $2
           AND salon.id = category.salon_id
         RETURNING category.id, salon.organization_id, category.name
       )
       INSERT INTO audit_logs (
         actor_account_id, actor_context, organization_id, salon_id,
         action, resource_type, resource_id, changes
       )
       SELECT $3, 'SALON', updated.organization_id, $1,
              'SALON_SERVICE_CATEGORY_UPDATED', 'SALON_SERVICE_CATEGORY',
              updated.id, jsonb_build_object('name', updated.name)
       FROM updated
       RETURNING resource_id`,
        values
      );
    } catch (error) {
      throw mapUniqueViolation(error, 'A service category with this name already exists');
    }
    if (!result.rowCount) throw new ApiError(404, 'Service category was not found');
    return this.findCategory(salonId, categoryId);
  }

  async archiveCategory(salonId: string, categoryId: string, accountId: string) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const services = await client.query(
        `SELECT 1 FROM salon_services
         WHERE salon_id = $1 AND category_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [salonId, categoryId]
      );
      if (services.rowCount) {
        throw new ApiError(409, 'Move or archive services before archiving this category');
      }
      const result = await client.query(
        `UPDATE salon_service_categories AS category
         SET is_active = FALSE
         FROM salons AS salon
         WHERE category.salon_id = $1 AND category.id = $2
           AND salon.id = category.salon_id
         RETURNING salon.organization_id`,
        [salonId, categoryId]
      );
      if (!result.rows[0]) throw new ApiError(404, 'Service category was not found');
      await this.writeAudit(client, accountId, result.rows[0].organization_id, salonId,
        'SALON_SERVICE_CATEGORY_ARCHIVED', categoryId, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listDefaultImages(categoryKey: string): Promise<ServiceDefaultImageRow[]> {
    const result = await db.query<ServiceDefaultImageRow>(
      `SELECT id, category_key AS "categoryKey", alt_text AS "altText", object_key AS "objectKey"
       FROM salon_service_default_images
       WHERE category_key = $1 AND is_active = TRUE
       ORDER BY created_at DESC`,
      [categoryKey]
    );
    return result.rows;
  }

  async createDefaultImage(
    defaultImageId: string,
    accountId: string,
    categoryKey: string,
    altText: string | undefined,
    objectKey: string
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO salon_service_default_images (
           id, category_key, object_key, alt_text, created_by_account_id
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, category_key AS "categoryKey", alt_text AS "altText",
                   object_key AS "objectKey"`,
        [defaultImageId, categoryKey, objectKey, altText ?? null, accountId]
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_account_id, actor_context, action, resource_type, resource_id, changes
         )
         VALUES ($1, 'ADMIN', 'SERVICE_DEFAULT_IMAGE_CREATED',
                 'SERVICE_DEFAULT_IMAGE', $2, jsonb_build_object('categoryKey', $3))`,
        [accountId, result.rows[0].id, categoryKey]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDefaultImage(
    accountId: string,
    defaultImageId: string,
    data: { isActive?: boolean; altText?: string | null }
  ) {
    const columns: Record<string, string> = { isActive: 'is_active', altText: 'alt_text' };
    const values: unknown[] = [defaultImageId, accountId];
    const assignments = Object.entries(data).map(([key, value]) => {
      values.push(value);
      return `${columns[key]} = $${values.length}`;
    });
    const result = await db.query(
      `WITH updated AS (
         UPDATE salon_service_default_images
         SET ${assignments.join(', ')}
         WHERE id = $1
         RETURNING id, category_key AS "categoryKey", alt_text AS "altText",
                   object_key AS "objectKey", is_active AS "isActive"
       )
       INSERT INTO audit_logs (
         actor_account_id, actor_context, action, resource_type, resource_id, changes
       )
       SELECT $2, 'ADMIN', 'SERVICE_DEFAULT_IMAGE_UPDATED',
              'SERVICE_DEFAULT_IMAGE', updated.id,
              jsonb_build_object('isActive', updated."isActive")
       FROM updated
       RETURNING resource_id`,
      values
    );
    if (!result.rowCount) throw new ApiError(404, 'Default service image was not found');
    const image = await db.query(
      `SELECT id, category_key AS "categoryKey", alt_text AS "altText",
              object_key AS "objectKey", is_active AS "isActive"
       FROM salon_service_default_images WHERE id = $1`,
      [defaultImageId]
    );
    return image.rows[0];
  }

  async updateImageSettings(accountId: string, serviceImageRequired: boolean) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const previous = await client.query(
        `SELECT service_image_required AS "serviceImageRequired"
         FROM platform_service_image_settings WHERE id = TRUE FOR UPDATE`
      );
      if (serviceImageRequired) {
        const missing = await client.query(
          `SELECT COUNT(*)::integer AS count
           FROM salon_services
           WHERE deleted_at IS NULL AND is_active = TRUE
             AND image_object_key IS NULL AND default_image_id IS NULL`
        );
        if (missing.rows[0].count > 0) {
          throw new ApiError(409, 'Active services without images must be updated before requiring images');
        }
      }
      await client.query(
        `INSERT INTO platform_service_image_settings (
           id, service_image_required, updated_by_account_id, updated_at
         )
         VALUES (TRUE, $1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE
         SET service_image_required = EXCLUDED.service_image_required,
             updated_by_account_id = EXCLUDED.updated_by_account_id,
             updated_at = CURRENT_TIMESTAMP`,
        [serviceImageRequired, accountId]
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_account_id, actor_context, action, resource_type, resource_id, changes
         )
         VALUES ($1, 'ADMIN', 'SERVICE_IMAGE_POLICY_UPDATED',
                 'PLATFORM_SERVICE_IMAGE_SETTINGS', 'true',
                 jsonb_build_object(
                   'before', $2::jsonb,
                   'after', $3::jsonb
                 ))`,
        [
          accountId,
          JSON.stringify(previous.rows[0] ?? null),
          JSON.stringify({ serviceImageRequired }),
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { serviceImageRequired };
  }

  private async findCategory(salonId: string, categoryId: string) {
    const result = await db.query(
      `SELECT category.id, category.salon_id AS "salonId", category.name,
              category.description,
              category.default_image_category_key AS "defaultImageCategoryKey",
              category.display_order AS "displayOrder", category.is_active AS "isActive",
              COUNT(service.id)::integer AS "serviceCount"
       FROM salon_service_categories AS category
       LEFT JOIN salon_services AS service
         ON service.category_id = category.id AND service.deleted_at IS NULL
       WHERE category.salon_id = $1 AND category.id = $2
       GROUP BY category.id`,
      [salonId, categoryId]
    );
    return result.rows[0] ?? null;
  }

  private async assertServiceImageChoice(
    client: PoolClient,
    salonId: string,
    categoryId: string | null | undefined,
    defaultImageId: string | undefined,
    imageObjectKey: string | null
  ) {
    if (categoryId) {
      const category = await client.query(
        `SELECT id, default_image_category_key
         FROM salon_service_categories
        WHERE id = $1 AND salon_id = $2 AND is_active = TRUE`,
        [categoryId, salonId]
      );
      if (!category.rows[0]) throw new ApiError(400, 'Service category is not active');
    } else if (defaultImageId) {
      throw new ApiError(400, 'A service category with a default-image group is required for default images');
    }
    if (defaultImageId) {
      const image = await client.query(
        `SELECT default_image.category_key, category.default_image_category_key
        FROM salon_service_default_images AS default_image
        LEFT JOIN salon_service_categories AS category
          ON category.id = $2 AND category.salon_id = $3
        WHERE default_image.id = $1 AND default_image.is_active = TRUE`,
        [defaultImageId, categoryId ?? null, salonId]
      );
      if (!image.rows[0]) throw new ApiError(400, 'Default service image is not active');
      const categoryKey = image.rows[0].default_image_category_key;
      if (!categoryKey) {
        throw new ApiError(400, 'Service category has no default image group');
      }
      if (image.rows[0].category_key !== categoryKey) {
        throw new ApiError(400, 'Default image does not match the service category');
      }
    }
    if (defaultImageId && imageObjectKey) {
      throw new ApiError(400, 'Choose either an uploaded image or a system default image');
    }
  }

  private async writeAudit(
    client: PoolClient,
    accountId: string,
    organizationId: string,
    salonId: string,
    action: string,
    resourceId: string,
    changes: unknown
  ) {
    await client.query(
      `INSERT INTO audit_logs (
         actor_account_id, actor_context, organization_id, salon_id,
         action, resource_type, resource_id, changes
       )
       VALUES ($1, 'SALON', $2, $3, $4, 'SALON_SERVICE', $5, $6::jsonb)`,
      [accountId, organizationId, salonId, action, resourceId, JSON.stringify(changes)]
    );
  }
}

function mapUniqueViolation(error: unknown, message: string): unknown {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    return new ApiError(409, message);
  }
  return error;
}
