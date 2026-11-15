import { Pool } from 'pg';
import {
    SalonPublicProfile,
    GalleryCategory,
    GalleryImage,
    PublicGalleryPage,
    PublicSalonSearchResult,
    SalonSearchQuery,
} from './discovery.types';

export class DiscoveryRepository {
    constructor(private pool: Pool) {}

    async searchPublicSalons(query: SalonSearchQuery) {
        const searchTerm = query.query ? `%${query.query}%` : null;
        const cityTerm = query.city ? `%${query.city}%` : null;
        const serviceTerm = query.service ? `%${query.service}%` : null;
        const filters = `
            salon.status = 'ACTIVE'
            AND salon.deleted_at IS NULL
            AND EXISTS (
                SELECT 1 FROM salon_applications AS application
                WHERE application.salon_id = salon.id AND application.status = 'APPROVED'
            )
            AND ($1::text IS NULL OR salon.name ILIKE $1 OR profile.slug ILIKE $1
                 OR profile.public_description ILIKE $1 OR profile.address_text ILIKE $1)
            AND ($2::text IS NULL OR salon.city ILIKE $2)
            AND ($3::text IS NULL OR EXISTS (
                SELECT 1 FROM salon_services AS service
                WHERE service.salon_id = salon.id
                  AND service.is_public = TRUE
                  AND service.is_active = TRUE
                  AND service.deleted_at IS NULL
                  AND service.name ILIKE $3
            ))`;
        const [items, count] = await Promise.all([
            this.pool.query<PublicSalonSearchResult>(
                `SELECT salon.id AS "salonId",
                        salon.name,
                        profile.slug,
                        salon.city,
                        profile.address_text AS "addressText",
                        profile.public_description AS "publicDescription",
                        profile.is_verified AS "isVerified"
                 FROM salons AS salon
                 JOIN salon_public_profiles AS profile ON profile.salon_id = salon.id
                 WHERE ${filters}
                 ORDER BY profile.is_verified DESC, salon.name ASC, salon.id
                 LIMIT $4 OFFSET $5`,
                [searchTerm, cityTerm, serviceTerm, query.limit, query.offset]
            ),
            this.pool.query<{ total: number }>(
                `SELECT COUNT(*)::int AS total
                 FROM salons AS salon
                 JOIN salon_public_profiles AS profile ON profile.salon_id = salon.id
                 WHERE ${filters}`,
                [searchTerm, cityTerm, serviceTerm]
            ),
        ]);
        return {
            items: items.rows.map((row) => ({
                ...row,
                city: row.city ?? undefined,
                addressText: row.addressText ?? undefined,
                publicDescription: row.publicDescription ?? undefined,
            })),
            total: count.rows[0].total,
        };
    }

    async getProfileBySlug(slug: string): Promise<SalonPublicProfile | null> {
        const res = await this.pool.query<{
            salonId: string;
            slug: string;
            publicDescription: string | null;
            contactPhone: string | null;
            contactEmail: string | null;
            addressText: string | null;
            latitude: string | null;
            longitude: string | null;
            isVerified: boolean;
        }>(
            `SELECT
                public_profile.salon_id AS "salonId",
                public_profile.slug,
                public_description AS "publicDescription",
                contact_phone AS "contactPhone",
                contact_email AS "contactEmail",
                address_text AS "addressText",
                latitude::text AS latitude,
                longitude::text AS longitude,
                is_verified AS "isVerified"
             FROM salon_public_profiles AS public_profile
             JOIN salons AS salon ON salon.id = public_profile.salon_id
             JOIN salon_applications AS application
               ON application.salon_id = salon.id
              AND application.status = 'APPROVED'
             WHERE public_profile.slug = $1
               AND salon.status = 'ACTIVE'
               AND salon.deleted_at IS NULL`,
            [slug]
        );
        const profile = res.rows[0];
        if (!profile) return null;
        return {
            salonId: profile.salonId,
            slug: profile.slug,
            publicDescription: profile.publicDescription ?? undefined,
            contactPhone: profile.contactPhone ?? undefined,
            contactEmail: profile.contactEmail ?? undefined,
            addressText: profile.addressText ?? undefined,
            latitude: profile.latitude == null ? undefined : Number(profile.latitude),
            longitude: profile.longitude == null ? undefined : Number(profile.longitude),
            isVerified: profile.isVerified,
        };
    }

    async getGallery(salonId: string, limit: number, offset: number): Promise<PublicGalleryPage> {
        const [res, count] = await Promise.all([
            this.pool.query<{
                categoryId: string;
                categorySalonId: string;
                categoryName: string;
                categoryDisplayOrder: number;
                imageId: string | null;
                imageSalonId: string | null;
                imageUrl: string | null;
                altText: string | null;
                isFeatured: boolean | null;
            }>(
            `WITH image_page AS (
                SELECT
                    category.id AS "categoryId",
                    category.salon_id AS "categorySalonId",
                    category.category_name AS "categoryName",
                    category.display_order AS "categoryDisplayOrder",
                    image.id AS "imageId",
                    image.salon_id AS "imageSalonId",
                    image.image_url AS "imageUrl",
                    image.alt_text AS "altText",
                    image.is_featured AS "isFeatured",
                    image.display_order AS "imageDisplayOrder"
                FROM salon_gallery_categories AS category
                JOIN salon_gallery_images AS image
                  ON image.category_id = category.id
                 AND image.salon_id = category.salon_id
                JOIN salons AS salon
                  ON salon.id = category.salon_id
                 AND salon.status = 'ACTIVE'
                 AND salon.deleted_at IS NULL
                JOIN salon_applications AS application
                  ON application.salon_id = salon.id
                 AND application.status = 'APPROVED'
                WHERE category.salon_id = $1
                  AND category.is_active = TRUE
                  AND image.is_active = TRUE
                ORDER BY category.display_order, image.display_order, image.id
                LIMIT $2 OFFSET $3
            )
            SELECT
                categoryId,
                categorySalonId,
                categoryName,
                categoryDisplayOrder,
                imageId,
                imageSalonId,
                imageUrl,
                altText,
                isFeatured
            FROM image_page
            ORDER BY categoryDisplayOrder, imageDisplayOrder, imageId`,
            [salonId, limit, offset]
        ),
            this.pool.query<{ total: number }>(
                `SELECT COUNT(*)::int AS total
                 FROM salon_gallery_categories AS category
                 JOIN salon_gallery_images AS image
                   ON image.category_id = category.id
                  AND image.salon_id = category.salon_id
                 JOIN salons AS salon
                   ON salon.id = category.salon_id
                  AND salon.status = 'ACTIVE'
                  AND salon.deleted_at IS NULL
                 JOIN salon_applications AS application
                   ON application.salon_id = salon.id
                  AND application.status = 'APPROVED'
                 WHERE category.salon_id = $1
                   AND category.is_active = TRUE
                   AND image.is_active = TRUE`,
                [salonId]
            ),
        ]);

        const gallery = new Map<string, { category: GalleryCategory; images: GalleryImage[] }>();
        for (const row of res.rows) {
            let entry = gallery.get(row.categoryId);
            if (!entry) {
                entry = {
                    category: {
                        id: row.categoryId,
                        salonId: row.categorySalonId,
                        categoryName: row.categoryName,
                        displayOrder: row.categoryDisplayOrder,
                    },
                    images: [],
                };
                gallery.set(row.categoryId, entry);
            }
            if (row.imageId && row.imageSalonId && row.imageUrl) {
                entry.images.push({
                    id: row.imageId,
                    categoryId: row.categoryId,
                    salonId: row.imageSalonId,
                    imageUrl: row.imageUrl,
                    altText: row.altText ?? undefined,
                    isFeatured: row.isFeatured ?? false,
                });
            }
        }
        return { items: [...gallery.values()], total: count.rows[0].total };
    }

    async getLivePulse(salonId: string): Promise<{
        activeCustomers: number;
        estimatedWaitTime: number;
        nextAvailableSlot: Date;
    }> {
        const result = await this.pool.query<{
            activeCustomers: number;
            estimatedWaitTime: number;
        }>(
            `SELECT
                COUNT(*)::int AS "activeCustomers",
                COALESCE(SUM(estimated_duration_minutes), 0)::int AS "estimatedWaitTime"
             FROM queue_entries
             WHERE salon_id = $1 AND status = 'WAITING'`,
            [salonId]
        );
        const activeCustomers = result.rows[0].activeCustomers;
        const estimatedWaitTime = result.rows[0].estimatedWaitTime;

        return {
            activeCustomers,
            estimatedWaitTime,
            nextAvailableSlot: new Date(Date.now() + estimatedWaitTime * 60_000),
        };
    }
}
