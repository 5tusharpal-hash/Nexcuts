import type { PoolClient, QueryResultRow } from 'pg';
import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
    CloseInventoryIssueRequest,
    ConsumableMapping,
    CreateConsumableMappingRequest,
    CreateInventoryIssueRequest,
    CreateInventoryProductRequest,
    ClassifyLegacyProductRequest,
    InventoryAdjustmentRequest,
    InventoryBatch,
    InventoryLedgerEntry,
    InventoryLowStockAlert,
    InventoryProduct,
    InventoryProductType,
    InventoryPageQuery,
    ReceiveInventoryBatchRequest,
    ReviewInventoryIssueRequest,
    ServiceConsumableUsageEntry,
    UpdateInventoryProductRequest,
} from './inventory.types.js';

interface ProductRow extends QueryResultRow {
    id: string;
    salonId: string;
    inventoryType: InventoryProductType;
    name: string;
    sku: string | null;
    description: string | null;
    category: string | null;
    baseUnit: InventoryProduct['baseUnit'];
    contentQuantity: string | null;
    contentUnit: InventoryProduct['contentUnit'];
    currentStock: string;
    reorderLevel: string;
    lowStockAlertEnabled: boolean;
    costPrice: string | null;
    retailPrice: string | null;
    isActive: boolean;
    barcodes: string[];
    createdAt: Date;
    updatedAt: Date;
}

interface BatchRow extends QueryResultRow {
    id: string;
    salonId: string;
    productId: string;
    batchNumber: string | null;
    expiryDate: string | null;
    initialQuantity: string;
    currentQuantity: string;
    costPerUnit: string | null;
    receivedAt: Date;
    expiryStatus: InventoryBatch['expiryStatus'];
}

const productColumns = `
    product.id, product.salon_id AS "salonId",
    product.inventory_type AS "inventoryType", product.name, product.sku,
    product.description, product.category, product.base_unit AS "baseUnit",
    product.content_quantity::text AS "contentQuantity",
    product.content_unit AS "contentUnit",
    product.current_stock::text AS "currentStock",
    product.reorder_level::text AS "reorderLevel",
    product.low_stock_alert_enabled AS "lowStockAlertEnabled",
    product.cost_price::text AS "costPrice",
    product.retail_price::text AS "retailPrice",
    product.is_active AS "isActive",
    COALESCE((
        SELECT array_agg(barcode.barcode ORDER BY barcode.barcode)
        FROM salon_product_barcodes AS barcode
        WHERE barcode.product_id = product.id AND barcode.salon_id = product.salon_id
    ), ARRAY[]::varchar[]) AS barcodes,
    product.created_at AS "createdAt", product.updated_at AS "updatedAt"`;

export class InventoryRepository {
    async listProducts(
        salonId: string,
        query: InventoryPageQuery & {
            inventoryType?: InventoryProductType;
            includeInactive: boolean;
        }
    ): Promise<InventoryProduct[]> {
        const result = await db.query<ProductRow>(
            `SELECT ${productColumns}
             FROM salon_products AS product
             WHERE product.salon_id = $1
               AND ($2::varchar IS NULL OR product.inventory_type = $2)
               AND ($3::boolean OR (product.is_active = TRUE AND product.deleted_at IS NULL))
             ORDER BY product.name, product.id
             LIMIT $4 OFFSET $5`,
            [
                salonId,
                query.inventoryType ?? null,
                query.includeInactive,
                query.limit,
                query.offset,
            ]
        );
        return result.rows.map((row) => this.toProduct(row));
    }

    async getProduct(salonId: string, productId: string): Promise<InventoryProduct | null> {
        const result = await db.query<ProductRow>(
            `SELECT ${productColumns}
             FROM salon_products AS product
             WHERE product.id = $1 AND product.salon_id = $2
               AND product.deleted_at IS NULL`,
            [productId, salonId]
        );
        return result.rows[0] ? this.toProduct(result.rows[0]) : null;
    }

    async createProduct(
        salonId: string,
        input: CreateInventoryProductRequest
    ): Promise<InventoryProduct> {
        try {
            return await this.withTransaction(async (client) => {
                if (input.barcodes.length !== new Set(input.barcodes).size) {
                    throw new ApiError(400, 'Product barcodes must be unique');
                }
                const created = await client.query<{ id: string }>(
                    `INSERT INTO salon_products (
                        salon_id, inventory_type, sku, name, description, category,
                        base_unit, content_quantity, content_unit, reorder_level,
                        low_stock_alert_enabled, cost_price, retail_price,
                        is_sellable, is_internal_only
                     ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
                     )
                     RETURNING id`,
                    [
                        salonId,
                        input.inventoryType,
                        input.sku ?? null,
                        input.name,
                        input.description ?? null,
                        input.category ?? null,
                        input.baseUnit,
                        input.contentQuantity ?? null,
                        input.contentUnit ?? null,
                        input.reorderLevel,
                        input.lowStockAlertEnabled,
                        input.costPrice ?? null,
                        input.retailPrice ?? null,
                        input.inventoryType === 'RETAIL',
                        input.inventoryType === 'SALON_USE',
                    ]
                );
                const productId = created.rows[0].id;
                for (const barcode of input.barcodes) {
                    await client.query(
                        `INSERT INTO salon_product_barcodes (salon_id, product_id, barcode)
                         VALUES ($1, $2, $3)`,
                        [salonId, productId, barcode]
                    );
                }
                return this.getProductWithClient(client, salonId, productId);
            });
        } catch (error) {
            if (InventoryRepository.isUniqueConstraintViolation(error)) {
                throw new ApiError(409, 'The SKU or barcode is already registered for this inventory product type');
            }
            throw error;
        }
    }

    async listIssueEvents(salonId: string, requestId: string) {
        const result = await db.query(
            `SELECT event.id, event.event_type AS "eventType",
                    event.actor_account_id AS "actorAccountId", event.note,
                    event.created_at AS "createdAt"
             FROM salon_inventory_issue_events AS event
             JOIN salon_inventory_issue_requests AS request
               ON request.id = event.request_id AND request.salon_id = event.salon_id
             WHERE event.salon_id = $1 AND event.request_id = $2
             ORDER BY event.created_at, event.id`,
            [salonId, requestId]
        );
        return result.rows;
    }

    async runDueReminders() {
        return this.withTransaction(async (client) => {
            const lock = await client.query<{ acquired: boolean }>(
                `SELECT pg_try_advisory_xact_lock(hashtextextended('salonix-inventory-reminders', 0))
                    AS acquired`
            );
            if (!lock.rows[0]?.acquired) return { skipped: true, notificationsCreated: 0 };

            let notificationsCreated = 0;
            const lowStock = await client.query<{
                salonId: string;
                productId: string;
                name: string;
                currentStock: string;
                reorderLevel: string;
                unit: string;
            }>(
                `SELECT salon_id AS "salonId", id AS "productId", name,
                        current_stock::text AS "currentStock",
                        reorder_level::text AS "reorderLevel", base_unit AS unit
                 FROM salon_products
                 WHERE is_active = TRUE AND deleted_at IS NULL
                   AND low_stock_alert_enabled = TRUE
                   AND current_stock <= reorder_level`
            );
            const lowStockIds = new Set<string>();
            for (const product of lowStock.rows) {
                lowStockIds.add(`${product.salonId}:${product.productId}`);
                const state = await client.query(
                    `INSERT INTO salon_inventory_reminder_states (
                        salon_id, product_id, alert_type, is_active, last_notified_at
                     ) VALUES ($1, $2, 'LOW_STOCK', TRUE, CURRENT_TIMESTAMP)
                     ON CONFLICT (salon_id, product_id, alert_type)
                     DO UPDATE SET is_active = TRUE, resolved_at = NULL,
                                   last_notified_at = CURRENT_TIMESTAMP
                     WHERE salon_inventory_reminder_states.is_active = FALSE
                     RETURNING id`,
                    [product.salonId, product.productId]
                );
                if (!state.rowCount) continue;
                const recipients = await this.getInventoryRecipients(client, product.salonId);
                for (const accountId of recipients) {
                    await this.insertInAppNotification(
                        client,
                        accountId,
                        product.salonId,
                        'Inventory is low',
                        `${product.name} has ${product.currentStock} ${product.unit} remaining; reorder level is ${product.reorderLevel}.`,
                        { type: 'INVENTORY_LOW_STOCK', productId: product.productId }
                    );
                    notificationsCreated += 1;
                }
            }

            const activeStates = await client.query<{ salonId: string; productId: string }>(
                `SELECT salon_id AS "salonId", product_id AS "productId"
                 FROM salon_inventory_reminder_states
                 WHERE alert_type = 'LOW_STOCK' AND is_active = TRUE`
            );
            for (const state of activeStates.rows) {
                if (lowStockIds.has(`${state.salonId}:${state.productId}`)) continue;
                await client.query(
                    `UPDATE salon_inventory_reminder_states
                     SET is_active = FALSE, resolved_at = CURRENT_TIMESTAMP
                     WHERE salon_id = $1 AND product_id = $2 AND alert_type = 'LOW_STOCK'`,
                    [state.salonId, state.productId]
                );
            }

            const expiring = await client.query<{
                salonId: string;
                batchId: string;
                productId: string;
                productName: string;
                batchNumber: string | null;
                expiryDate: string;
                leadDays: number;
            }>(
                `SELECT batch.salon_id AS "salonId", batch.id AS "batchId",
                        batch.product_id AS "productId", product.name AS "productName",
                        batch.batch_number AS "batchNumber",
                        to_char(batch.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
                        (batch.expiry_date - CURRENT_DATE)::integer AS "leadDays"
                 FROM salon_inventory_batches AS batch
                 JOIN salon_products AS product
                   ON product.id = batch.product_id AND product.salon_id = batch.salon_id
                 WHERE batch.current_quantity > 0
                   AND batch.expiry_date IN (CURRENT_DATE + 7, CURRENT_DATE + 30)
                   AND product.is_active = TRUE AND product.deleted_at IS NULL`
            );
            for (const batch of expiring.rows) {
                const recipients = await this.getInventoryRecipients(client, batch.salonId);
                for (const accountId of recipients) {
                    const delivery = await client.query(
                        `INSERT INTO salon_inventory_reminder_deliveries (
                            salon_id, account_id, batch_id, expiry_date, lead_days
                         ) VALUES ($1, $2, $3, $4, $5)
                         ON CONFLICT (batch_id, expiry_date, lead_days, account_id) DO NOTHING
                         RETURNING id`,
                        [batch.salonId, accountId, batch.batchId, batch.expiryDate, batch.leadDays]
                    );
                    if (!delivery.rowCount) continue;
                    const batchLabel = batch.batchNumber ?? 'unlabelled batch';
                    await this.insertInAppNotification(
                        client,
                        accountId,
                        batch.salonId,
                        'Inventory batch nearing expiry',
                        `${batch.productName} (${batchLabel}) expires in ${batch.leadDays} days.`,
                        {
                            type: 'INVENTORY_EXPIRY',
                            productId: batch.productId,
                            batchId: batch.batchId,
                            expiryDate: batch.expiryDate,
                        }
                    );
                    notificationsCreated += 1;
                }
            }
            return { skipped: false, notificationsCreated };
        });
    }

    private async getInventoryRecipients(client: PoolClient, salonId: string): Promise<string[]> {
        const result = await client.query<{ accountId: string }>(
            `SELECT DISTINCT recipients.account_id AS "accountId"
             FROM (
                SELECT owner.account_id
                FROM salon_organization_owners AS owner
                JOIN salons AS salon ON salon.organization_id = owner.organization_id
                JOIN salon_applications AS application ON application.salon_id = salon.id
                WHERE salon.id = $1 AND salon.status = 'ACTIVE'
                  AND salon.deleted_at IS NULL AND application.status = 'APPROVED'
                UNION
                SELECT membership.account_id
                FROM salon_memberships AS membership
                JOIN salon_membership_locations AS location
                  ON location.membership_id = membership.id
                 AND location.organization_id = membership.organization_id
                JOIN salons AS salon ON salon.id = location.salon_id
                JOIN salon_applications AS application ON application.salon_id = salon.id
                JOIN salon_membership_roles AS membership_role
                  ON membership_role.membership_id = membership.id
                 AND membership_role.salon_id = location.salon_id
                JOIN salon_role_permissions AS role_permission
                  ON role_permission.role_id = membership_role.role_id
                WHERE location.salon_id = $1
                  AND membership.status = 'ACTIVE'
                  AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
                  AND application.status = 'APPROVED'
                  AND role_permission.permission_key = 'inventory:manage'
             ) AS recipients`,
            [salonId]
        );
        return result.rows.map((row) => row.accountId);
    }

    private async assertInventoryManager(
        client: PoolClient,
        salonId: string,
        accountId: string
    ) {
        const result = await client.query(
            `SELECT 1
             FROM salon_organization_owners AS owner
             JOIN salons AS salon ON salon.organization_id = owner.organization_id
             JOIN salon_applications AS application ON application.salon_id = salon.id
             WHERE owner.account_id = $1 AND salon.id = $2
               AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
               AND application.status = 'APPROVED'
             UNION
             SELECT 1
             FROM salon_memberships AS membership
             JOIN salon_membership_locations AS location
               ON location.membership_id = membership.id
              AND location.organization_id = membership.organization_id
             JOIN salons AS salon ON salon.id = location.salon_id
             JOIN salon_applications AS application ON application.salon_id = salon.id
             JOIN salon_membership_roles AS membership_role
               ON membership_role.membership_id = membership.id
              AND membership_role.salon_id = location.salon_id
             JOIN salon_role_permissions AS role_permission
               ON role_permission.role_id = membership_role.role_id
             WHERE membership.account_id = $1 AND location.salon_id = $2
               AND membership.status = 'ACTIVE'
               AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
               AND application.status = 'APPROVED'
               AND role_permission.permission_key = 'inventory:manage'
             LIMIT 1`,
            [accountId, salonId]
        );
        if (!result.rowCount) throw new ApiError(403, 'Inventory manager permission is required');
    }

    private async insertInAppNotification(
        client: PoolClient,
        accountId: string,
        salonId: string,
        title: string,
        body: string,
        metadata: Record<string, string>
    ) {
        await client.query(
            `INSERT INTO account_notifications (
                account_id, salon_id, title, body, channel, priority, status, metadata
             ) VALUES ($1, $2, $3, $4, 'IN_APP', 'NORMAL', 'PENDING', $5::jsonb)`,
            [accountId, salonId, title, body, JSON.stringify(metadata)]
        );
    }

    async updateProduct(
        salonId: string,
        productId: string,
        input: UpdateInventoryProductRequest
    ): Promise<InventoryProduct> {
        return this.withTransaction(async (client) => {
            const current = await client.query<{
                contentQuantity: string | null;
                contentUnit: string | null;
            }>(
                `SELECT content_quantity::text AS "contentQuantity",
                        content_unit AS "contentUnit"
                 FROM salon_products
                 WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL
                 FOR UPDATE`,
                [productId, salonId]
            );
            const product = current.rows[0];
            if (!product) throw new ApiError(404, 'Inventory product was not found');
            const contentQuantity = Object.prototype.hasOwnProperty.call(input, 'contentQuantity')
                ? input.contentQuantity
                : product.contentQuantity === null ? null : Number(product.contentQuantity);
            const contentUnit = Object.prototype.hasOwnProperty.call(input, 'contentUnit')
                ? input.contentUnit
                : product.contentUnit;
            if ((contentQuantity === null || contentQuantity === undefined) !==
                (contentUnit === null || contentUnit === undefined)) {
                throw new ApiError(400, 'Content quantity and unit must be set or cleared together');
            }
            if (contentUnit !== product.contentUnit) {
                const mappings = await client.query(
                    `SELECT 1 FROM salon_service_consumables
                     WHERE salon_id = $1 AND product_id = $2 LIMIT 1`,
                    [salonId, productId]
                );
                if (mappings.rowCount) {
                    throw new ApiError(409, 'Remove service mappings before changing the content unit');
                }
            }

            const columns: Array<[keyof UpdateInventoryProductRequest, string]> = [
                ['name', 'name'],
                ['sku', 'sku'],
                ['description', 'description'],
                ['category', 'category'],
                ['contentQuantity', 'content_quantity'],
                ['contentUnit', 'content_unit'],
                ['reorderLevel', 'reorder_level'],
                ['lowStockAlertEnabled', 'low_stock_alert_enabled'],
                ['costPrice', 'cost_price'],
                ['retailPrice', 'retail_price'],
            ];
            const setClauses: string[] = [];
            const values: Array<string | number | boolean | null> = [productId, salonId];
            for (const [field, column] of columns) {
                if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
                const value = input[field];
                if (value === undefined) continue;
                values.push(value);
                setClauses.push(`${column} = $${values.length}`);
            }
            if (setClauses.length === 0) throw new ApiError(400, 'At least one product field is required');
            setClauses.push('updated_at = CURRENT_TIMESTAMP');
            await client.query(
                `UPDATE salon_products
                 SET ${setClauses.join(', ')}
                 WHERE id = $1 AND salon_id = $2`,
                values
            );
            return this.getProductWithClient(client, salonId, productId);
        });
    }

    async archiveProduct(salonId: string, productId: string): Promise<void> {
        const result = await db.query(
            `UPDATE salon_products
             SET is_active = FALSE, deleted_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL`,
            [productId, salonId]
        );
        if (!result.rowCount) throw new ApiError(404, 'Inventory product was not found');
    }

    async classifyLegacyProduct(
        salonId: string,
        productId: string,
        input: ClassifyLegacyProductRequest
    ): Promise<InventoryProduct> {
        return this.withTransaction(async (client) => {
            const current = await client.query<{
                inventoryType: string;
                baseUnit: string;
                retailPrice: string | null;
                contentUnit: string | null;
            }>(
                `SELECT inventory_type AS "inventoryType", base_unit AS "baseUnit",
                        retail_price::text AS "retailPrice", content_unit AS "contentUnit"
                 FROM salon_products
                 WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL
                 FOR UPDATE`,
                [productId, salonId]
            );
            const product = current.rows[0];
            if (!product) throw new ApiError(404, 'Inventory product was not found');
            if (product.inventoryType !== 'LEGACY_UNCLASSIFIED') {
                throw new ApiError(409, 'Only legacy unclassified products can be classified');
            }
            if (product.baseUnit !== 'UNIT' && product.baseUnit !== 'PACK') {
                throw new ApiError(
                    409,
                    'This legacy product uses a measured stock unit; create a new whole-unit record and reconcile its opening stock'
                );
            }
            if (input.inventoryType === 'SALON_USE' && !product.contentUnit) {
                throw new ApiError(
                    409,
                    'Add the bottle or pack content unit before classifying this product for salon use'
                );
            }
            if (input.inventoryType === 'RETAIL' && product.retailPrice === null) {
                throw new ApiError(409, 'Set the retail price before classifying this product as retail');
            }
            await client.query(
                `UPDATE salon_products
                 SET inventory_type = $3,
                     is_sellable = ($3 = 'RETAIL'),
                     is_internal_only = ($3 = 'SALON_USE'),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [productId, salonId, input.inventoryType]
            );
            return this.getProductWithClient(client, salonId, productId);
        });
    }

    async receiveBatch(
        salonId: string,
        productId: string,
        actorAccountId: string,
        input: ReceiveInventoryBatchRequest
    ): Promise<InventoryBatch> {
        return this.withTransaction(async (client) => {
            const product = await client.query<{ inventoryType: InventoryProductType; baseUnit: string }>(
                `SELECT inventory_type AS "inventoryType", base_unit AS "baseUnit"
                 FROM salon_products
                 WHERE id = $1 AND salon_id = $2 AND is_active = TRUE AND deleted_at IS NULL
                 FOR UPDATE`,
                [productId, salonId]
            );
            if (!product.rows[0]) throw new ApiError(404, 'Active inventory product was not found');
            this.assertWholePackQuantity(product.rows[0].baseUnit, input.quantity);
            const batch = await client.query<{ id: string }>(
                `INSERT INTO salon_inventory_batches (
                    salon_id, product_id, batch_number, expiry_date,
                    initial_quantity, current_quantity, cost_per_unit
                 ) VALUES ($1, $2, $3, $4, $5, $5, $6)
                 RETURNING id`,
                [
                    salonId, productId, input.batchNumber ?? null,
                    input.expiryDate ?? null, input.quantity, input.costPerUnit ?? null,
                ]
            );
            await client.query(
                `UPDATE salon_products
                 SET current_stock = current_stock + $3, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [productId, salonId, input.quantity]
            );
            await this.insertLedger(
                client, salonId, productId, batch.rows[0].id,
                input.quantity, 'RESTOCK', actorAccountId
            );
            return this.getBatchWithClient(client, salonId, productId, batch.rows[0].id);
        });
    }

    async listBatches(
        salonId: string,
        productId: string,
        query: InventoryPageQuery
    ): Promise<InventoryBatch[]> {
        const result = await db.query<BatchRow>(
            `SELECT batch.id, batch.salon_id AS "salonId", batch.product_id AS "productId",
                    batch.batch_number AS "batchNumber",
                    to_char(batch.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
                    batch.initial_quantity::text AS "initialQuantity",
                    batch.current_quantity::text AS "currentQuantity",
                    batch.cost_per_unit::text AS "costPerUnit",
                    batch.received_at AS "receivedAt",
                    CASE
                        WHEN batch.expiry_date IS NULL THEN 'UNKNOWN'
                        WHEN batch.expiry_date < CURRENT_DATE THEN 'EXPIRED'
                        WHEN batch.expiry_date <= CURRENT_DATE + 30 THEN 'NEAR_EXPIRY'
                        ELSE 'OK'
                    END AS "expiryStatus"
             FROM salon_inventory_batches AS batch
             JOIN salon_products AS product
               ON product.id = batch.product_id AND product.salon_id = batch.salon_id
             WHERE batch.salon_id = $1 AND batch.product_id = $2
               AND product.deleted_at IS NULL
             ORDER BY batch.received_at DESC, batch.id
             LIMIT $3 OFFSET $4`,
            [salonId, productId, query.limit, query.offset]
        );
        return result.rows.map((row) => this.toBatch(row));
    }

    async lookupBarcode(salonId: string, barcode: string) {
        const productResult = await db.query<ProductRow>(
            `SELECT ${productColumns}
             FROM salon_product_barcodes AS barcode
             JOIN salon_products AS product
               ON product.id = barcode.product_id AND product.salon_id = barcode.salon_id
             WHERE barcode.salon_id = $1 AND barcode.barcode = $2
               AND product.is_active = TRUE AND product.deleted_at IS NULL`,
            [salonId, barcode]
        );
        if (!productResult.rows.length) {
            throw new ApiError(404, 'No active inventory product matches this barcode');
        }
        const matches = await Promise.all(productResult.rows.map(async (row) => ({
            product: this.toProduct(row),
            batches: await this.listBatches(salonId, row.id, { limit: 100, offset: 0 }),
        })));
        return { matches };
    }

    async addBarcode(salonId: string, productId: string, barcode: string) {
        const product = await db.query(
            `SELECT id FROM salon_products
             WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL`,
            [productId, salonId]
        );
        if (!product.rowCount) throw new ApiError(404, 'Inventory product was not found');
        try {
            await db.query(
                `INSERT INTO salon_product_barcodes (salon_id, product_id, barcode)
                 VALUES ($1, $2, $3)`,
                [salonId, productId, barcode]
            );
        } catch (error) {
            if (InventoryRepository.isUniqueConstraintViolation(error)) {
                throw new ApiError(409, 'This barcode is already registered for the inventory product');
            }
            throw error;
        }
        return { productId, barcode };
    }

    async removeBarcode(salonId: string, productId: string, barcode: string): Promise<void> {
        const result = await db.query(
            `DELETE FROM salon_product_barcodes
             WHERE salon_id = $1 AND product_id = $2 AND barcode = $3`,
            [salonId, productId, barcode]
        );
        if (!result.rowCount) throw new ApiError(404, 'Product barcode was not found');
    }

    async adjustBatch(
        salonId: string,
        productId: string,
        actorAccountId: string,
        input: InventoryAdjustmentRequest
    ): Promise<void> {
        await this.withTransaction(async (client) => {
            const batch = await client.query<{ currentQuantity: string; baseUnit: string }>(
                `SELECT batch.current_quantity::text AS "currentQuantity",
                        product.base_unit AS "baseUnit"
                 FROM salon_inventory_batches AS batch
                 JOIN salon_products AS product
                   ON product.id = batch.product_id AND product.salon_id = batch.salon_id
                 WHERE batch.id = $1 AND batch.product_id = $2 AND batch.salon_id = $3
                 FOR UPDATE OF batch, product`,
                [input.batchId, productId, salonId]
            );
            const current = batch.rows[0];
            if (!current) throw new ApiError(404, 'Inventory batch was not found');
            this.assertWholePackQuantity(current.baseUnit, input.quantityChange);
            const changed = await client.query(
                `UPDATE salon_inventory_batches
                 SET current_quantity = current_quantity + $4
                 WHERE id = $1 AND product_id = $2 AND salon_id = $3
                   AND current_quantity + $4 >= 0`,
                [input.batchId, productId, salonId, input.quantityChange]
            );
            if (!changed.rowCount) throw new ApiError(409, 'Adjustment would make batch stock negative');
            const productChanged = await client.query(
                `UPDATE salon_products
                 SET current_stock = current_stock + $3, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2 AND current_stock + $3 >= 0`,
                [productId, salonId, input.quantityChange]
            );
            if (!productChanged.rowCount) throw new ApiError(409, 'Adjustment would make product stock negative');
            await this.insertLedger(
                client,
                salonId,
                productId,
                input.batchId,
                input.quantityChange,
                input.reason,
                actorAccountId,
                null,
                input.note
            );
        });
    }

    async getLedger(
        salonId: string,
        productId: string,
        query: InventoryPageQuery
    ): Promise<InventoryLedgerEntry[]> {
        const result = await db.query<InventoryLedgerEntry>(
            `SELECT id, product_id AS "productId", batch_id AS "batchId",
                    quantity_change::float8 AS "quantityChange", reason,
                    reference_id AS "referenceId",
                    created_by_account_id AS "createdByAccountId", note,
                    created_at AS "createdAt"
             FROM salon_inventory_ledger
             WHERE salon_id = $1 AND product_id = $2
             ORDER BY created_at DESC, id DESC
             LIMIT $3 OFFSET $4`,
            [salonId, productId, query.limit, query.offset]
        );
        return result.rows;
    }

    async listExpiringBatches(
        salonId: string,
        query: InventoryPageQuery
    ): Promise<InventoryBatch[]> {
        const result = await db.query<BatchRow>(
            `SELECT batch.id, batch.salon_id AS "salonId", batch.product_id AS "productId",
                    batch.batch_number AS "batchNumber",
                    to_char(batch.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
                    batch.initial_quantity::text AS "initialQuantity",
                    batch.current_quantity::text AS "currentQuantity",
                    batch.cost_per_unit::text AS "costPerUnit",
                    batch.received_at AS "receivedAt",
                    CASE
                        WHEN batch.expiry_date < CURRENT_DATE THEN 'EXPIRED'
                        WHEN batch.expiry_date <= CURRENT_DATE + 30 THEN 'NEAR_EXPIRY'
                        ELSE 'OK'
                    END AS "expiryStatus"
             FROM salon_inventory_batches AS batch
             JOIN salon_products AS product
               ON product.id = batch.product_id AND product.salon_id = batch.salon_id
             WHERE batch.salon_id = $1 AND batch.current_quantity > 0
               AND batch.expiry_date IS NOT NULL
               AND batch.expiry_date <= CURRENT_DATE + 30
               AND product.is_active = TRUE AND product.deleted_at IS NULL
             ORDER BY batch.expiry_date, product.name, batch.id
             LIMIT $2 OFFSET $3`,
            [salonId, query.limit, query.offset]
        );
        return result.rows.map((row) => this.toBatch(row));
    }

    async listServiceUsage(
        salonId: string,
        productId: string | undefined,
        query: InventoryPageQuery
    ): Promise<ServiceConsumableUsageEntry[]> {
        const result = await db.query<{
            id: string;
            serviceId: string;
            productId: string;
            productName: string;
            billId: string;
            billItemId: string;
            estimatedQuantity: string;
            quantityUnit: InventoryProduct['contentUnit'];
            recordedByAccountId: string;
            createdAt: Date;
        }>(
            `SELECT usage.id, usage.service_id AS "serviceId",
                    usage.product_id AS "productId", product.name AS "productName",
                    usage.bill_id AS "billId", usage.bill_item_id AS "billItemId",
                    usage.estimated_quantity::text AS "estimatedQuantity",
                    usage.quantity_unit AS "quantityUnit",
                    usage.recorded_by_account_id AS "recordedByAccountId",
                    usage.created_at AS "createdAt"
             FROM salon_service_consumable_usage AS usage
             JOIN salon_products AS product
               ON product.id = usage.product_id AND product.salon_id = usage.salon_id
             WHERE usage.salon_id = $1
               AND ($2::uuid IS NULL OR usage.product_id = $2)
             ORDER BY usage.created_at DESC, usage.id DESC
             LIMIT $3 OFFSET $4`,
            [salonId, productId ?? null, query.limit, query.offset]
        );
        return result.rows.map((row) => ({
            ...row,
            estimatedQuantity: Number(row.estimatedQuantity),
            quantityUnit: row.quantityUnit ?? 'UNIT',
        }));
    }

    async getConsumablesForService(serviceId: string, salonId: string): Promise<ConsumableMapping[]> {
        const result = await db.query<{
            serviceId: string;
            productId: string;
            productName: string;
            quantityRequired: string;
            quantityUnit: InventoryProduct['contentUnit'];
        }>(
            `SELECT mapping.service_id AS "serviceId", mapping.product_id AS "productId",
                    product.name AS "productName",
                    mapping.quantity_required::text AS "quantityRequired",
                    product.content_unit AS "quantityUnit"
             FROM salon_service_consumables AS mapping
             JOIN salon_products AS product
               ON product.id = mapping.product_id AND product.salon_id = mapping.salon_id
             WHERE mapping.service_id = $1 AND mapping.salon_id = $2
             ORDER BY product.name`,
            [serviceId, salonId]
        );
        return result.rows.map((row) => ({
            ...row,
            quantityRequired: Number(row.quantityRequired),
            quantityUnit: row.quantityUnit ?? 'UNIT',
        }));
    }

    async createConsumableMapping(
        salonId: string,
        serviceId: string,
        input: CreateConsumableMappingRequest
    ) {
        const result = await db.query(
            `INSERT INTO salon_service_consumables (
                salon_id, service_id, product_id, quantity_required
             )
             SELECT $1, service.id, product.id, $4
             FROM salon_services AS service
             JOIN salon_products AS product
               ON product.id = $3 AND product.salon_id = $1
             WHERE service.id = $2 AND service.salon_id = $1
               AND service.is_active = TRUE AND service.deleted_at IS NULL
               AND product.inventory_type = 'SALON_USE'
               AND product.is_active = TRUE AND product.deleted_at IS NULL
               AND product.content_unit IS NOT NULL`,
            [salonId, serviceId, input.productId, input.quantityRequired]
        );
        if (!result.rowCount) {
            throw new ApiError(404, 'Active service or salon-use product with a content unit was not found');
        }
        return {
            serviceId,
            productId: input.productId,
            quantityRequired: input.quantityRequired,
        };
    }

    async updateConsumableMapping(
        salonId: string,
        serviceId: string,
        productId: string,
        quantityRequired: number
    ) {
        const result = await db.query(
            `UPDATE salon_service_consumables
             SET quantity_required = $4
             WHERE salon_id = $1 AND service_id = $2 AND product_id = $3`,
            [salonId, serviceId, productId, quantityRequired]
        );
        if (!result.rowCount) throw new ApiError(404, 'Service consumable mapping was not found');
        return { serviceId, productId, quantityRequired };
    }

    async deleteConsumableMapping(salonId: string, serviceId: string, productId: string) {
        const result = await db.query(
            `DELETE FROM salon_service_consumables
             WHERE salon_id = $1 AND service_id = $2 AND product_id = $3`,
            [salonId, serviceId, productId]
        );
        if (!result.rowCount) throw new ApiError(404, 'Service consumable mapping was not found');
    }

    async getLowStockItems(
        salonId: string,
        query: InventoryPageQuery
    ): Promise<InventoryLowStockAlert[]> {
        const result = await db.query<{
            productId: string;
            productName: string;
            inventoryType: InventoryProductType;
            currentStock: string;
            reorderLevel: string;
            unit: InventoryProduct['baseUnit'];
        }>(
            `SELECT id AS "productId", name AS "productName",
                    inventory_type AS "inventoryType",
                    current_stock::text AS "currentStock",
                    reorder_level::text AS "reorderLevel", base_unit AS unit
             FROM salon_products
             WHERE salon_id = $1 AND is_active = TRUE AND deleted_at IS NULL
               AND low_stock_alert_enabled = TRUE
               AND current_stock <= reorder_level
             ORDER BY current_stock, name
             LIMIT $2 OFFSET $3`,
            [salonId, query.limit, query.offset]
        );
        return result.rows.map((row) => ({
            ...row,
            currentStock: Number(row.currentStock),
            reorderLevel: Number(row.reorderLevel),
        }));
    }

    async createIssueRequest(
        salonId: string,
        actorAccountId: string,
        input: CreateInventoryIssueRequest
    ) {
        return this.withTransaction(async (client) => {
            const membership = await client.query<{ membershipId: string }>(
                `SELECT membership.id AS "membershipId"
                 FROM salon_memberships AS membership
                 JOIN salon_membership_locations AS location
                   ON location.membership_id = membership.id
                  AND location.organization_id = membership.organization_id
                 JOIN salons AS salon ON salon.id = location.salon_id
                 JOIN salon_applications AS application ON application.salon_id = salon.id
                 WHERE membership.account_id = $1 AND location.salon_id = $2
                   AND membership.status = 'ACTIVE'
                   AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
                   AND application.status = 'APPROVED'
                 LIMIT 1`,
                [actorAccountId, salonId]
            );
            if (!membership.rowCount) throw new ApiError(403, 'Active salon membership is required');
            if (
                input.targetType === 'STAFF' &&
                input.targetMembershipId !== membership.rows[0].membershipId
            ) {
                throw new ApiError(403, 'Staff can request salon-use products only for themselves');
            }
            const product = await client.query<{ inventoryType: string; baseUnit: string }>(
                `SELECT inventory_type AS "inventoryType", base_unit AS "baseUnit"
                 FROM salon_products
                 WHERE id = $1 AND salon_id = $2 AND is_active = TRUE AND deleted_at IS NULL`,
                [input.productId, salonId]
            );
            if (!product.rows[0] || product.rows[0].inventoryType !== 'SALON_USE') {
                throw new ApiError(404, 'Active salon-use inventory product was not found');
            }
            this.assertWholePackQuantity(product.rows[0].baseUnit, input.quantity);
            const request = await client.query<{ id: string }>(
                `INSERT INTO salon_inventory_issue_requests (
                    salon_id, product_id, target_type, target_membership_id,
                    requested_by_account_id, quantity, request_note
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id`,
                [
                    salonId, input.productId, input.targetType,
                    input.targetMembershipId ?? null, actorAccountId,
                    input.quantity, input.note ?? null,
                ]
            );
            await this.addIssueEvent(
                client, salonId, request.rows[0].id, 'REQUESTED', actorAccountId, input.note
            );
            const recipients = await this.getInventoryRecipients(client, salonId);
            for (const accountId of recipients) {
                await this.insertInAppNotification(
                    client,
                    accountId,
                    salonId,
                    'Salon-use product requested',
                    `A staff member requested ${input.quantity} ${product.rows[0].baseUnit} of salon-use stock.`,
                    { type: 'INVENTORY_ISSUE_REQUEST', requestId: request.rows[0].id }
                );
            }
            return this.getIssueRequest(client, salonId, request.rows[0].id);
        });
    }

    async listIssueRequests(
        salonId: string,
        query: InventoryPageQuery,
        actorAccountId?: string
    ) {
        const result = await db.query(
            `SELECT request.id, request.product_id AS "productId",
                    product.name AS "productName", request.target_type AS "targetType",
                    request.target_membership_id AS "targetMembershipId",
                    recipient.account_id AS "targetAccountId",
                    request.requested_by_account_id AS "requestedByAccountId",
                    request.quantity::float8 AS quantity, request.status,
                    request.request_note AS "requestNote", request.batch_id AS "batchId",
                    request.issued_by_account_id AS "issuedByAccountId",
                    request.issued_at AS "issuedAt", request.closed_at AS "closedAt",
                    request.created_at AS "createdAt"
             FROM salon_inventory_issue_requests AS request
             JOIN salon_products AS product
               ON product.id = request.product_id AND product.salon_id = request.salon_id
             LEFT JOIN salon_memberships AS recipient
               ON recipient.id = request.target_membership_id
             WHERE request.salon_id = $1
               AND ($2::uuid IS NULL OR request.requested_by_account_id = $2)
             ORDER BY request.created_at DESC, request.id DESC
             LIMIT $3 OFFSET $4`,
            [salonId, actorAccountId ?? null, query.limit, query.offset]
        );
        return result.rows;
    }

    async reviewIssueRequest(
        salonId: string,
        requestId: string,
        actorAccountId: string,
        input: ReviewInventoryIssueRequest
    ) {
        return this.withTransaction(async (client) => {
            const issue = await client.query<{
                id: string;
                productId: string;
                quantity: string;
                status: string;
                requestedByAccountId: string;
            }>(
                `SELECT id, product_id AS "productId", quantity::text AS quantity, status,
                        requested_by_account_id AS "requestedByAccountId"
                 FROM salon_inventory_issue_requests
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [requestId, salonId]
            );
            const request = issue.rows[0];
            if (!request) throw new ApiError(404, 'Inventory issue request was not found');
            if (request.status !== 'REQUESTED') {
                throw new ApiError(409, 'Only pending inventory issue requests can be reviewed');
            }
            if (input.status === 'REJECTED') {
                await client.query(
                    `UPDATE salon_inventory_issue_requests
                     SET status = 'REJECTED', issued_by_account_id = $3,
                         closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1 AND salon_id = $2`,
                    [requestId, salonId, actorAccountId]
                );
                await this.addIssueEvent(
                    client, salonId, requestId, 'REJECTED', actorAccountId, input.reason
                );
                await this.insertInAppNotification(
                    client,
                    request.requestedByAccountId,
                    salonId,
                    'Salon-use product request declined',
                    input.reason ?? 'Your inventory issue request was declined.',
                    { type: 'INVENTORY_ISSUE_REJECTED', requestId }
                );
            } else {
                const batchId = input.batchId;
                if (!batchId) {
                    throw new ApiError(400, 'Select the actual batch being handed over');
                }
                const batch = await client.query<{
                    currentQuantity: string;
                    isExpired: boolean;
                }>(
                    `SELECT current_quantity::text AS "currentQuantity",
                            COALESCE(expiry_date < CURRENT_DATE, FALSE) AS "isExpired"
                     FROM salon_inventory_batches
                     WHERE id = $1 AND product_id = $2 AND salon_id = $3
                     FOR UPDATE`,
                    [batchId, request.productId, salonId]
                );
                const selectedBatch = batch.rows[0];
                if (!selectedBatch) throw new ApiError(404, 'Selected inventory batch was not found');
                if (Number(selectedBatch.currentQuantity) < Number(request.quantity)) {
                    throw new ApiError(409, 'Selected batch does not have enough stock');
                }
                if (
                    selectedBatch.isExpired &&
                    !input.expiredOverrideReason
                ) {
                    throw new ApiError(409, 'Selected batch is expired; provide an authorized override reason');
                }
                const updatedBatch = await client.query(
                    `UPDATE salon_inventory_batches
                     SET current_quantity = current_quantity - $4
                     WHERE id = $1 AND product_id = $2 AND salon_id = $3
                       AND current_quantity >= $4`,
                    [batchId, request.productId, salonId, request.quantity]
                );
                if (!updatedBatch.rowCount) throw new ApiError(409, 'Selected batch stock changed; retry the issue');
                const updatedProduct = await client.query(
                    `UPDATE salon_products
                     SET current_stock = current_stock - $3, updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1 AND salon_id = $2 AND current_stock >= $3`,
                    [request.productId, salonId, request.quantity]
                );
                if (!updatedProduct.rowCount) throw new ApiError(409, 'Product stock changed; retry the issue');
                await this.insertLedger(
                    client, salonId, request.productId, batchId,
                    -Number(request.quantity), 'INTERNAL_ISSUE', actorAccountId,
                    requestId,
                    input.expiredOverrideReason
                );
                await client.query(
                    `UPDATE salon_inventory_issue_requests
                     SET status = 'ISSUED', batch_id = $3, issued_by_account_id = $4,
                         issued_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1 AND salon_id = $2`,
                    [requestId, salonId, batchId, actorAccountId]
                );
                await this.addIssueEvent(
                    client,
                    salonId,
                    requestId,
                    'ISSUED',
                    actorAccountId,
                    input.expiredOverrideReason ?? null
                );
                await this.insertInAppNotification(
                    client,
                    request.requestedByAccountId,
                    salonId,
                    'Salon-use product issued',
                    'Your requested salon-use stock has been handed over.',
                    { type: 'INVENTORY_ISSUE_ISSUED', requestId }
                );
            }
            return this.getIssueRequest(client, salonId, requestId);
        });
    }

    async closeIssueRequest(
        salonId: string,
        requestId: string,
        actorAccountId: string,
        input: CloseInventoryIssueRequest
    ) {
        return this.withTransaction(async (client) => {
            const issue = await client.query<{
                productId: string;
                batchId: string | null;
                quantity: string;
                status: string;
                requestedByAccountId: string;
                targetAccountId: string | null;
            }>(
                `SELECT request.product_id AS "productId", request.batch_id AS "batchId",
                        request.quantity::text AS quantity, request.status,
                        request.requested_by_account_id AS "requestedByAccountId",
                        membership.account_id AS "targetAccountId"
                 FROM salon_inventory_issue_requests AS request
                 LEFT JOIN salon_memberships AS membership
                   ON membership.id = request.target_membership_id
                 WHERE request.id = $1 AND request.salon_id = $2
                 FOR UPDATE`,
                [requestId, salonId]
            );
            const request = issue.rows[0];
            if (!request) throw new ApiError(404, 'Inventory issue request was not found');
            if (
                request.requestedByAccountId !== actorAccountId &&
                request.targetAccountId !== actorAccountId
            ) {
                await this.assertInventoryManager(client, salonId, actorAccountId);
            }
            if (request.status !== 'ISSUED' || !request.batchId) {
                throw new ApiError(409, 'Only issued inventory requests can be closed');
            }
            if (input.status === 'RETURNED') {
                await this.restoreBatchStock(
                    client, salonId, request.productId, request.batchId,
                    Number(request.quantity), actorAccountId, requestId
                );
            }
            await client.query(
                `UPDATE salon_inventory_issue_requests
                 SET status = $3, closed_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [requestId, salonId, input.status]
            );
            await this.addIssueEvent(
                client, salonId, requestId, input.status, actorAccountId, input.note
            );
            return this.getIssueRequest(client, salonId, requestId);
        });
    }

    private async restoreBatchStock(
        client: PoolClient,
        salonId: string,
        productId: string,
        batchId: string,
        quantity: number,
        actorAccountId: string,
        referenceId: string
    ) {
        const batch = await client.query(
            `UPDATE salon_inventory_batches
             SET current_quantity = current_quantity + $4
             WHERE id = $1 AND product_id = $2 AND salon_id = $3
             RETURNING id`,
            [batchId, productId, salonId, quantity]
        );
        if (!batch.rowCount) throw new ApiError(404, 'Inventory batch was not found');
        await client.query(
            `UPDATE salon_products
             SET current_stock = current_stock + $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND salon_id = $2`,
            [productId, salonId, quantity]
        );
        await this.insertLedger(
            client, salonId, productId, batchId, quantity,
            'INTERNAL_RETURN', actorAccountId, referenceId
        );
    }

    private async getProductWithClient(
        client: PoolClient,
        salonId: string,
        productId: string
    ): Promise<InventoryProduct> {
        const result = await client.query<ProductRow>(
            `SELECT ${productColumns}
             FROM salon_products AS product
             WHERE product.id = $1 AND product.salon_id = $2`,
            [productId, salonId]
        );
        if (!result.rows[0]) throw new ApiError(404, 'Inventory product was not found');
        return this.toProduct(result.rows[0]);
    }

    private async getBatchWithClient(
        client: PoolClient,
        salonId: string,
        productId: string,
        batchId: string
    ): Promise<InventoryBatch> {
        const result = await client.query<BatchRow>(
            `SELECT id, salon_id AS "salonId", product_id AS "productId",
                    batch_number AS "batchNumber",
                    to_char(expiry_date, 'YYYY-MM-DD') AS "expiryDate",
                    initial_quantity::text AS "initialQuantity",
                    current_quantity::text AS "currentQuantity",
                    cost_per_unit::text AS "costPerUnit",
                    received_at AS "receivedAt",
                    CASE
                        WHEN expiry_date IS NULL THEN 'UNKNOWN'
                        WHEN expiry_date < CURRENT_DATE THEN 'EXPIRED'
                        WHEN expiry_date <= CURRENT_DATE + 30 THEN 'NEAR_EXPIRY'
                        ELSE 'OK'
                    END AS "expiryStatus"
             FROM salon_inventory_batches
             WHERE id = $1 AND salon_id = $2 AND product_id = $3`,
            [batchId, salonId, productId]
        );
        if (!result.rows[0]) throw new ApiError(404, 'Inventory batch was not found');
        return this.toBatch(result.rows[0]);
    }

    private async getIssueRequest(client: PoolClient, salonId: string, requestId: string) {
        const result = await client.query(
            `SELECT request.id, request.product_id AS "productId",
                    product.name AS "productName", request.target_type AS "targetType",
                    request.target_membership_id AS "targetMembershipId",
                    request.requested_by_account_id AS "requestedByAccountId",
                    request.quantity::float8 AS quantity, request.status,
                    request.request_note AS "requestNote", request.batch_id AS "batchId",
                    request.issued_by_account_id AS "issuedByAccountId",
                    request.issued_at AS "issuedAt", request.closed_at AS "closedAt",
                    request.created_at AS "createdAt"
             FROM salon_inventory_issue_requests AS request
             JOIN salon_products AS product
               ON product.id = request.product_id AND product.salon_id = request.salon_id
             WHERE request.id = $1 AND request.salon_id = $2`,
            [requestId, salonId]
        );
        if (!result.rows[0]) throw new ApiError(404, 'Inventory issue request was not found');
        return result.rows[0];
    }

    private async addIssueEvent(
        client: PoolClient,
        salonId: string,
        requestId: string,
        eventType: string,
        actorAccountId: string,
        note?: string | null
    ) {
        await client.query(
            `INSERT INTO salon_inventory_issue_events (
                salon_id, request_id, event_type, actor_account_id, note
             ) VALUES ($1, $2, $3, $4, $5)`,
            [salonId, requestId, eventType, actorAccountId, note ?? null]
        );
    }

    private async insertLedger(
        client: PoolClient,
        salonId: string,
        productId: string,
        batchId: string,
        quantityChange: number,
        reason: string,
        actorAccountId: string,
        referenceId?: string | null,
        note?: string
    ) {
        await client.query(
            `INSERT INTO salon_inventory_ledger (
                salon_id, product_id, batch_id, quantity_change, reason,
                reference_id, created_by_account_id, note
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                salonId, productId, batchId, quantityChange, reason,
                referenceId ?? null, actorAccountId, note ?? null,
            ]
        );
    }

    private assertWholePackQuantity(unit: string, quantity: number) {
        if ((unit === 'UNIT' || unit === 'PACK') && !Number.isInteger(quantity)) {
            throw new ApiError(400, 'Bottle and pack stock quantities must be whole numbers');
        }
    }

    private static isUniqueConstraintViolation(error: unknown): boolean {
        return typeof error === 'object' && error !== null
            && 'code' in error && error.code === '23505';
    }

    private toProduct(row: ProductRow): InventoryProduct {
        return {
            ...row,
            contentQuantity: row.contentQuantity === null ? null : Number(row.contentQuantity),
            currentStock: Number(row.currentStock),
            reorderLevel: Number(row.reorderLevel),
            costPrice: row.costPrice === null ? null : Number(row.costPrice),
            retailPrice: row.retailPrice === null ? null : Number(row.retailPrice),
        };
    }

    private toBatch(row: BatchRow): InventoryBatch {
        return {
            ...row,
            initialQuantity: Number(row.initialQuantity),
            currentQuantity: Number(row.currentQuantity),
            costPerUnit: row.costPerUnit === null ? null : Number(row.costPerUnit),
        };
    }

    private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await operation(client);
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
