import { db } from '../../config/database.js';
import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
  GalleryCategoryResponse,
  GalleryImageResponse,
  GalleryQuotaResponse,
  SetGalleryQuotaOverrideRequest,
} from './services.types.js';

interface GalleryImageRow extends Omit<GalleryImageResponse, 'imageUrl'> {
  objectKey: string | null;
  legacyImageUrl: string | null;
}

export class GalleryRepository {
  async getQuota(salonId: string): Promise<GalleryQuotaResponse> {
    const client = await db.connect();
    try {
      return await this.getQuotaWithClient(client, salonId);
    } finally {
      client.release();
    }
  }

  async listCategories(salonId: string, limit: number, offset: number) {
    const result = await db.query<GalleryCategoryResponse>(
      `SELECT category.id, category.salon_id AS "salonId",
              category.category_name AS "categoryName",
              category.display_order AS "displayOrder",
              category.is_active AS "isActive",
              COUNT(image.id)::integer AS "imageCount"
       FROM salon_gallery_categories AS category
       LEFT JOIN salon_gallery_images AS image
         ON image.category_id = category.id
        AND image.salon_id = category.salon_id
        AND image.is_active = TRUE
       WHERE category.salon_id = $1
       GROUP BY category.id
       ORDER BY category.display_order, category.category_name
       LIMIT $2 OFFSET $3`,
      [salonId, limit, offset]
    );
    return result.rows;
  }

  async createCategory(
    salonId: string,
    accountId: string,
    categoryName: string,
    displayOrder: number
  ) {
    let result;
    try {
      result = await db.query<GalleryCategoryResponse>(
        `WITH created AS (
         INSERT INTO salon_gallery_categories (salon_id, category_name, display_order)
         SELECT $1, $2, $3
         FROM salons
         WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
         RETURNING id, salon_id, category_name, display_order, is_active
       ),
       audited AS (
         INSERT INTO audit_logs (
           actor_account_id, actor_context, organization_id, salon_id,
           action, resource_type, resource_id, changes
         )
         SELECT $4, 'SALON', salon.organization_id, $1,
                'SALON_GALLERY_CATEGORY_CREATED', 'SALON_GALLERY_CATEGORY',
                created.id, jsonb_build_object('categoryName', created.category_name)
         FROM created JOIN salons AS salon ON salon.id = created.salon_id
       )
       SELECT created.id, created.salon_id AS "salonId",
              created.category_name AS "categoryName",
              created.display_order AS "displayOrder",
              created.is_active AS "isActive", 0 AS "imageCount"
       FROM created`,
        [salonId, categoryName, displayOrder, accountId]
      );
    } catch (error) {
      throw mapUniqueViolation(error, 'A gallery category with this name already exists');
    }
    if (!result.rows[0]) throw new ApiError(404, 'Approved salon was not found');
    return result.rows[0];
  }

  async updateCategory(
    salonId: string,
    categoryId: string,
    accountId: string,
    data: { categoryName?: string; displayOrder?: number; isActive?: boolean }
  ) {
    const columns: Record<string, string> = {
      categoryName: 'category_name',
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
         UPDATE salon_gallery_categories AS category
         SET ${assignments.join(', ')}
         FROM salons AS salon
         WHERE category.salon_id = $1 AND category.id = $2
           AND salon.id = category.salon_id
         RETURNING category.id, salon.organization_id, category.category_name
       )
       INSERT INTO audit_logs (
         actor_account_id, actor_context, organization_id, salon_id,
         action, resource_type, resource_id, changes
       )
       SELECT $3, 'SALON', updated.organization_id, $1,
              'SALON_GALLERY_CATEGORY_UPDATED', 'SALON_GALLERY_CATEGORY',
              updated.id, jsonb_build_object('categoryName', updated.category_name)
       FROM updated
       RETURNING resource_id`,
        values
      );
    } catch (error) {
      throw mapUniqueViolation(error, 'A gallery category with this name already exists');
    }
    if (!result.rowCount) throw new ApiError(404, 'Gallery category was not found');
    const category = await db.query(
      `SELECT category.id, category.salon_id AS "salonId",
              category.category_name AS "categoryName",
              category.display_order AS "displayOrder",
              category.is_active AS "isActive",
              COUNT(image.id)::integer AS "imageCount"
       FROM salon_gallery_categories AS category
       LEFT JOIN salon_gallery_images AS image
         ON image.category_id = category.id AND image.is_active = TRUE
       WHERE category.salon_id = $1 AND category.id = $2
       GROUP BY category.id`,
      [salonId, categoryId]
    );
    return category.rows[0] ?? null;
  }

  async archiveCategory(salonId: string, categoryId: string, accountId: string) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const image = await client.query(
        `SELECT 1 FROM salon_gallery_images
         WHERE salon_id = $1 AND category_id = $2 AND is_active = TRUE LIMIT 1`,
        [salonId, categoryId]
      );
      if (image.rowCount) {
        throw new ApiError(409, 'Move or archive gallery images before archiving this category');
      }
      const category = await client.query(
        `UPDATE salon_gallery_categories AS category
         SET is_active = FALSE
         FROM salons AS salon
         WHERE category.salon_id = $1 AND category.id = $2
           AND salon.id = category.salon_id
         RETURNING salon.organization_id`,
        [salonId, categoryId]
      );
      if (!category.rows[0]) throw new ApiError(404, 'Gallery category was not found');
      await this.writeSalonAudit(client, accountId, category.rows[0].organization_id,
        salonId, 'SALON_GALLERY_CATEGORY_ARCHIVED', categoryId, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createImage(
    imageId: string,
    salonId: string,
    accountId: string,
    objectKey: string,
    data: {
      categoryId: string;
      altText?: string;
      isFeatured: boolean;
      displayOrder: number;
    }
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
      const quota = await this.getQuotaWithClient(client, salonId);
      if (!quota.enabled) {
        throw new ApiError(403, 'Public salon gallery is not enabled by the current plan');
      }
      if (quota.used >= quota.limit) {
        throw new ApiError(409, 'Public gallery image limit has been reached');
      }
      const category = await client.query(
        `SELECT id FROM salon_gallery_categories
         WHERE id = $1 AND salon_id = $2 AND is_active = TRUE`,
        [data.categoryId, salonId]
      );
      if (!category.rowCount) throw new ApiError(400, 'Gallery category is not active in this salon');
      const inserted = await client.query(
        `INSERT INTO salon_gallery_images (
           id, salon_id, category_id, image_url, object_key, alt_text,
           is_featured, display_order
         )
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
         RETURNING id, salon_id AS "salonId", category_id AS "categoryId",
                   object_key AS "objectKey", image_url AS "legacyImageUrl",
                   alt_text AS "altText",
                   is_featured AS "isFeatured", display_order AS "displayOrder",
                   is_active AS "isActive", created_at AS "createdAt"`,
        [
          imageId,
          salonId,
          data.categoryId,
          objectKey,
          data.altText ?? null,
          data.isFeatured,
          data.displayOrder,
        ]
      );
      await this.writeSalonAudit(client, accountId, salon.rows[0].organization_id,
        salonId, 'SALON_GALLERY_IMAGE_CREATED', inserted.rows[0].id, {
          categoryId: data.categoryId,
        });
      await client.query('COMMIT');
      return inserted.rows[0] as GalleryImageRow;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listImages(
    salonId: string,
    categoryId: string | undefined,
    limit: number,
    offset: number
  ) {
    const result = await db.query<GalleryImageRow>(
      `SELECT image.id, image.salon_id AS "salonId",
              image.category_id AS "categoryId", image.object_key AS "objectKey",
             image.image_url AS "legacyImageUrl",
              image.alt_text AS "altText", image.is_featured AS "isFeatured",
              image.display_order AS "displayOrder", image.is_active AS "isActive",
              image.created_at AS "createdAt"
       FROM salon_gallery_images AS image
       JOIN salon_gallery_categories AS category
         ON category.id = image.category_id AND category.salon_id = image.salon_id
       WHERE image.salon_id = $1
         AND ($2::uuid IS NULL OR image.category_id = $2)
       ORDER BY image.display_order, image.created_at DESC
       LIMIT $3 OFFSET $4`,
      [salonId, categoryId ?? null, limit, offset]
    );
    return result.rows;
  }

  async listPublicImages(
    salonId: string,
    categoryId: string | undefined,
    limit: number,
    offset: number
  ) {
    const quota = await this.getQuota(salonId);
    if (!quota.enabled) throw new ApiError(404, 'Public gallery is not available');
    const result = await db.query<GalleryImageRow>(
      `SELECT image.id, image.salon_id AS "salonId",
              image.category_id AS "categoryId", image.object_key AS "objectKey",
             image.image_url AS "legacyImageUrl",
              image.alt_text AS "altText", image.is_featured AS "isFeatured",
              image.display_order AS "displayOrder", image.is_active AS "isActive",
              image.created_at AS "createdAt"
       FROM salon_gallery_images AS image
       JOIN salon_gallery_categories AS category
         ON category.id = image.category_id AND category.salon_id = image.salon_id
       JOIN salons AS salon ON salon.id = image.salon_id
       JOIN salon_applications AS application ON application.salon_id = salon.id
       WHERE image.salon_id = $1 AND image.is_active = TRUE
         AND category.is_active = TRUE
         AND salon.status = 'ACTIVE' AND application.status = 'APPROVED'
         AND ($2::uuid IS NULL OR image.category_id = $2)
       ORDER BY image.is_featured DESC, image.display_order, image.created_at DESC
       LIMIT $3 OFFSET $4`,
      [salonId, categoryId ?? null, limit, offset]
    );
    return result.rows;
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
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (data.isActive === true) {
        await client.query('SELECT id FROM salons WHERE id = $1 FOR UPDATE', [salonId]);
        const quota = await this.getQuotaWithClient(client, salonId);
        const current = await client.query(
          `SELECT is_active FROM salon_gallery_images
           WHERE salon_id = $1 AND id = $2 FOR UPDATE`,
          [salonId, imageId]
        );
        if (!current.rows[0]) throw new ApiError(404, 'Gallery image was not found');
        if (!current.rows[0].is_active &&
            (!quota.enabled || quota.used >= quota.limit)) {
          throw new ApiError(409, 'Gallery image limit is not available for reactivation');
        }
      }
      if (data.categoryId) {
        const category = await client.query(
          `SELECT id FROM salon_gallery_categories
           WHERE id = $1 AND salon_id = $2 AND is_active = TRUE`,
          [data.categoryId, salonId]
        );
        if (!category.rowCount) throw new ApiError(400, 'Gallery category is not active in this salon');
      }
      const columns: Record<string, string> = {
        categoryId: 'category_id',
        altText: 'alt_text',
        isFeatured: 'is_featured',
        displayOrder: 'display_order',
        isActive: 'is_active',
      };
      const values: unknown[] = [
        salonId, imageId, accountId, JSON.stringify(data),
      ];
      const assignments = Object.entries(data).map(([key, value]) => {
        values.push(value);
        return `${columns[key]} = $${values.length}`;
      });
      const result = await client.query(
        `WITH updated AS (
           UPDATE salon_gallery_images AS image
           SET ${assignments.join(', ')}
           FROM salons AS salon
           WHERE image.salon_id = $1 AND image.id = $2
             AND salon.id = image.salon_id
           RETURNING image.id, salon.organization_id
         )
         INSERT INTO audit_logs (
           actor_account_id, actor_context, organization_id, salon_id,
           action, resource_type, resource_id, changes
         )
         SELECT $3, 'SALON', updated.organization_id, $1,
                'SALON_GALLERY_IMAGE_UPDATED', 'SALON_GALLERY_IMAGE',
                updated.id, $4::jsonb
         FROM updated
         RETURNING resource_id`,
        values
      );
      if (!result.rowCount) throw new ApiError(404, 'Gallery image was not found');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const image = await db.query<GalleryImageRow>(
      `SELECT id, salon_id AS "salonId", category_id AS "categoryId",
              object_key AS "objectKey", image_url AS "legacyImageUrl",
              alt_text AS "altText",
              is_featured AS "isFeatured", display_order AS "displayOrder",
              is_active AS "isActive", created_at AS "createdAt"
       FROM salon_gallery_images WHERE salon_id = $1 AND id = $2`,
      [salonId, imageId]
    );
    return image.rows[0] ?? null;
  }

  async setQuotaOverride(
    salonId: string,
    accountId: string,
    data: SetGalleryQuotaOverrideRequest
  ) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const salon = await client.query(
        'SELECT id FROM salons WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [salonId]
      );
      if (!salon.rowCount) throw new ApiError(404, 'Salon was not found');
      const override = await client.query(
        `INSERT INTO platform_salon_entitlement_overrides (
           salon_id, feature_key, feature_value, reason,
           granted_by_account_id, expires_at, updated_at
         )
         VALUES ($1, 'public_gallery_limit', $2::jsonb, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (salon_id, feature_key) DO UPDATE
         SET feature_value = EXCLUDED.feature_value,
             reason = EXCLUDED.reason,
             granted_by_account_id = EXCLUDED.granted_by_account_id,
             expires_at = EXCLUDED.expires_at,
             updated_at = CURRENT_TIMESTAMP
         RETURNING feature_value #>> '{}' AS "limit",
                   reason, expires_at AS "expiresAt"`,
        [salonId, JSON.stringify(data.limit), data.reason, accountId, data.expiresAt ?? null]
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_account_id, actor_context, organization_id, salon_id,
           action, resource_type, resource_id, changes
         )
         SELECT $2, 'ADMIN', salon.organization_id, $1,
                'PUBLIC_GALLERY_LIMIT_OVERRIDE_SET',
                'SALON_ENTITLEMENT_OVERRIDE', $1,
                jsonb_build_object(
                  'limit', $3, 'reason', $4, 'expiresAt', $5
                )
         FROM salons AS salon WHERE salon.id = $1`,
        [salonId, accountId, data.limit, data.reason, data.expiresAt ?? null]
      );
      await client.query('COMMIT');
      return override.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async getQuotaWithClient(
    client: PoolClient,
    salonId: string
  ): Promise<GalleryQuotaResponse> {
    const result = await client.query(
      `SELECT
         (SELECT override.feature_value #>> '{}'
          FROM platform_salon_entitlement_overrides AS override
          WHERE override.salon_id = salon.id
            AND override.feature_key = 'public_gallery_limit'
            AND (override.expires_at IS NULL OR override.expires_at > CURRENT_TIMESTAMP)
         ) AS override_limit,
         (SELECT feature.feature_value #>> '{}'
          FROM platform_subscriptions AS subscription
          JOIN platform_plan_catalog AS plan
            ON plan.id = subscription.plan_id AND plan.is_active = TRUE
          JOIN platform_plan_features AS feature ON feature.plan_id = plan.id
          WHERE subscription.salon_id = salon.id
            AND subscription.status = 'ACTIVE'
            AND subscription.billing_cycle_start <= CURRENT_DATE
            AND subscription.billing_cycle_end >= CURRENT_DATE
            AND feature.feature_key = 'public_gallery_limit'
          ORDER BY subscription.billing_cycle_end DESC
          LIMIT 1
         ) AS plan_limit,
         (SELECT feature.feature_value #>> '{}'
          FROM platform_salon_addons AS salon_addon
          JOIN platform_addons AS addon
            ON addon.id = salon_addon.addon_id AND addon.is_active = TRUE
          JOIN platform_addon_features AS feature ON feature.addon_id = addon.id
          WHERE salon_addon.salon_id = salon.id
            AND salon_addon.status = 'ACTIVE'
            AND feature.feature_key = 'public_gallery_limit'
          ORDER BY salon_addon.activated_at DESC
          LIMIT 1
         ) AS addon_limit,
         (SELECT COUNT(*)::integer
          FROM salon_gallery_images AS image
          WHERE image.salon_id = salon.id AND image.is_active = TRUE
         ) AS used
       FROM salons AS salon WHERE salon.id = $1`,
      [salonId]
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, 'Salon was not found');
    const overrideLimit = parseLimit(row.override_limit);
    const addonLimit = parseLimit(row.addon_limit);
    const planLimit = parseLimit(row.plan_limit);
    const limit = overrideLimit ?? addonLimit ?? planLimit ?? 0;
    const source = overrideLimit !== null
      ? 'ADMIN_OVERRIDE'
      : addonLimit !== null
        ? 'ADDON'
        : (planLimit ?? 0) > 0
          ? 'PLAN'
          : 'DISABLED';
    const used = Number(row.used);
    return {
      enabled: limit > 0,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      source,
    };
  }

  private async writeSalonAudit(
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
       VALUES ($1, 'SALON', $2, $3, $4, 'SALON_GALLERY', $5, $6::jsonb)`,
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

function parseLimit(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) ? limit : null;
}
