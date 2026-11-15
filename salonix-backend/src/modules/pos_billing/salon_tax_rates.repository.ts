import type { PoolClient, QueryResultRow } from 'pg';
import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
    createSalonTaxRateSchema,
    updateSalonTaxRateSchema,
} from './salon_tax_rates.validation.js';

type CreateInput = ReturnType<typeof createSalonTaxRateSchema.parse>;
type UpdateInput = ReturnType<typeof updateSalonTaxRateSchema.parse>;

interface TaxRateRow extends QueryResultRow {
    id: string;
    salonId: string;
    name: string;
    itemType: string;
    rate: string;
    isActive: boolean;
    createdAt: Date;
}

export class SalonTaxRatesRepository {
    async list(salonId: string) {
        const result = await db.query<TaxRateRow>(
            `SELECT id, salon_id AS "salonId", name, item_type AS "itemType",
                    rate::text AS rate, is_active AS "isActive", created_at AS "createdAt"
             FROM salon_tax_rates
             WHERE salon_id = $1
             ORDER BY item_type, name, created_at, id`,
            [salonId]
        );
        return result.rows.map((row) => ({ ...row, rate: Number(row.rate) }));
    }

    async create(salonId: string, input: CreateInput) {
        return this.withTransaction(async (client) => {
            await this.lockSalon(client, salonId);
            if (input.isActive) {
                const total = await this.activeRateTotal(client, salonId, input.itemType);
                if (total + input.rate > 100) {
                    throw new ApiError(400, `Combined ${input.itemType.toLowerCase()} tax exceeds 100%`);
                }
            }
            const result = await client.query<TaxRateRow>(
                `INSERT INTO salon_tax_rates (salon_id, name, item_type, rate, is_active)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, salon_id AS "salonId", name, item_type AS "itemType",
                           rate::text AS rate, is_active AS "isActive", created_at AS "createdAt"`,
                [salonId, input.name, input.itemType, input.rate, input.isActive]
            );
            return { ...result.rows[0], rate: Number(result.rows[0].rate) };
        });
    }

    async update(salonId: string, taxRateId: string, input: UpdateInput) {
        return this.withTransaction(async (client) => {
            await this.lockSalon(client, salonId);
            const existing = await client.query<TaxRateRow>(
                `SELECT id, salon_id AS "salonId", name, item_type AS "itemType",
                        rate::text AS rate, is_active AS "isActive", created_at AS "createdAt"
                 FROM salon_tax_rates WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
                [taxRateId, salonId]
            );
            const row = existing.rows[0];
            if (!row) throw new ApiError(404, 'Salon tax rate not found');
            const nextRate = input.rate ?? Number(row.rate);
            const nextActive = input.isActive ?? row.isActive;
            if (nextActive) {
                const total = await this.activeRateTotal(client, salonId, row.itemType, taxRateId);
                if (total + nextRate > 100) {
                    throw new ApiError(400, `Combined ${row.itemType.toLowerCase()} tax exceeds 100%`);
                }
            }
            const result = await client.query<TaxRateRow>(
                `UPDATE salon_tax_rates
                 SET name = $3, rate = $4, is_active = $5
                 WHERE id = $1 AND salon_id = $2
                 RETURNING id, salon_id AS "salonId", name, item_type AS "itemType",
                           rate::text AS rate, is_active AS "isActive", created_at AS "createdAt"`,
                [taxRateId, salonId, input.name ?? row.name, nextRate, nextActive]
            );
            return { ...result.rows[0], rate: Number(result.rows[0].rate) };
        });
    }

    async deactivate(salonId: string, taxRateId: string) {
        const result = await db.query(
            `UPDATE salon_tax_rates
             SET is_active = FALSE
             WHERE id = $1 AND salon_id = $2 AND is_active = TRUE
             RETURNING id`,
            [taxRateId, salonId]
        );
        if (!result.rowCount) throw new ApiError(404, 'Active salon tax rate not found');
    }

    private async lockSalon(client: PoolClient, salonId: string) {
        const result = await client.query(
            `SELECT id FROM salons WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
            [salonId]
        );
        if (!result.rowCount) throw new ApiError(404, 'Salon not found');
    }

    private async activeRateTotal(
        client: PoolClient,
        salonId: string,
        itemType: string,
        excludedId?: string
    ) {
        const result = await client.query<{ total: string }>(
            `SELECT COALESCE(SUM(rate), 0)::text AS total
             FROM salon_tax_rates
             WHERE salon_id = $1 AND item_type = $2 AND is_active = TRUE
               AND ($3::uuid IS NULL OR id <> $3)`,
            [salonId, itemType, excludedId ?? null]
        );
        return Number(result.rows[0].total);
    }

    private async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
