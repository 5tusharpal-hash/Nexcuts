BEGIN;

ALTER TABLE salon_products
    ADD COLUMN inventory_type VARCHAR(24) NOT NULL DEFAULT 'LEGACY_UNCLASSIFIED',
    ADD COLUMN content_quantity NUMERIC(12, 3),
    ADD COLUMN content_unit VARCHAR(20),
    ADD COLUMN low_stock_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE salon_products
SET inventory_type = CASE
    WHEN is_sellable AND NOT is_internal_only AND base_unit IN ('UNIT', 'PACK') THEN 'RETAIL'
    WHEN is_internal_only AND NOT is_sellable AND base_unit IN ('UNIT', 'PACK') THEN 'SALON_USE'
    ELSE 'LEGACY_UNCLASSIFIED'
END;

ALTER TABLE salon_products
    ADD CONSTRAINT salon_products_inventory_type_check
        CHECK (inventory_type IN ('RETAIL', 'SALON_USE', 'LEGACY_UNCLASSIFIED')),
    ADD CONSTRAINT salon_products_content_check
        CHECK (
            (content_quantity IS NULL AND content_unit IS NULL)
            OR (
                content_quantity IS NOT NULL
                AND content_unit IS NOT NULL
                AND content_quantity > 0
                AND content_unit IN ('ML', 'GRAM', 'UNIT')
            )
        );

ALTER TABLE salon_products
    DROP CONSTRAINT salon_products_salon_id_sku_key;

ALTER TABLE salon_products
    ADD CONSTRAINT salon_products_salon_type_sku_key
        UNIQUE (salon_id, inventory_type, sku);

ALTER TABLE salon_product_barcodes
    DROP CONSTRAINT salon_product_barcodes_salon_id_barcode_key,
    ADD CONSTRAINT salon_product_barcodes_product_barcode_key
        UNIQUE (salon_id, product_id, barcode);

ALTER TABLE salon_inventory_batches
    ADD CONSTRAINT salon_inventory_batches_id_salon_key
        UNIQUE (id, salon_id),
    ADD CONSTRAINT salon_inventory_batches_id_salon_product_key
        UNIQUE (id, salon_id, product_id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM salon_products AS product
        JOIN LATERAL (
            SELECT COALESCE(SUM(batch.current_quantity), 0) AS current_quantity
            FROM salon_inventory_batches AS batch
            WHERE batch.salon_id = product.salon_id
              AND batch.product_id = product.id
        ) AS batch_totals ON TRUE
        WHERE batch_totals.current_quantity > product.current_stock
    ) THEN
        RAISE EXCEPTION
            'Inventory migration stopped: existing batch totals exceed product totals; reconcile those balances before retrying';
    END IF;
END
$$;

INSERT INTO salon_inventory_batches (
    salon_id, product_id, batch_number, initial_quantity, current_quantity
)
SELECT
    product.salon_id,
    product.id,
    'OPENING-' || product.id::text,
    GREATEST(product.current_stock - COALESCE(batch_totals.current_quantity, 0), 0),
    GREATEST(product.current_stock - COALESCE(batch_totals.current_quantity, 0), 0)
FROM salon_products AS product
LEFT JOIN LATERAL (
    SELECT SUM(batch.current_quantity) AS current_quantity
    FROM salon_inventory_batches AS batch
    WHERE batch.salon_id = product.salon_id
      AND batch.product_id = product.id
) AS batch_totals ON TRUE
WHERE product.current_stock > COALESCE(batch_totals.current_quantity, 0);

ALTER TABLE salon_inventory_ledger
    DROP CONSTRAINT salon_inventory_ledger_reason_check,
    ADD CONSTRAINT salon_inventory_ledger_reason_check
        CHECK (reason IN (
            'RETAIL_SALE', 'SERVICE_USE', 'EXPIRY', 'OPENING_BALANCE',
            'RESTOCK', 'ADJUSTMENT', 'RETURN', 'INTERNAL_ISSUE',
            'INTERNAL_RETURN', 'DAMAGE', 'LOSS', 'WASTE'
        ));

ALTER TABLE salon_inventory_ledger
    ADD COLUMN note TEXT,
    DROP CONSTRAINT salon_inventory_ledger_batch_id_fkey,
    ADD CONSTRAINT salon_inventory_ledger_batch_scope_fkey
        FOREIGN KEY (batch_id, salon_id, product_id)
        REFERENCES salon_inventory_batches(id, salon_id, product_id) ON DELETE RESTRICT;

INSERT INTO salon_inventory_ledger (
    salon_id, product_id, batch_id, quantity_change, reason, note
)
SELECT
    batch.salon_id,
    batch.product_id,
    batch.id,
    batch.initial_quantity,
    'OPENING_BALANCE',
    'Opening stock attributed during the inventory migration'
FROM salon_inventory_batches AS batch
WHERE batch.batch_number = 'OPENING-' || batch.id::text
  AND batch.initial_quantity > 0;

CREATE TABLE salon_service_consumable_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    product_id UUID NOT NULL,
    bill_id UUID NOT NULL,
    bill_item_id UUID NOT NULL,
    estimated_quantity NUMERIC(12, 3) NOT NULL CHECK (estimated_quantity > 0),
    quantity_unit VARCHAR(20) NOT NULL CHECK (quantity_unit IN ('ML', 'GRAM', 'UNIT')),
    recorded_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (bill_item_id, product_id),
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, salon_id)
        REFERENCES salon_products(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (bill_item_id, salon_id)
        REFERENCES pos_bill_items(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX salon_service_consumable_usage_product_idx
    ON salon_service_consumable_usage (salon_id, product_id, created_at);

CREATE TABLE salon_inventory_issue_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    product_id UUID NOT NULL,
    target_type VARCHAR(12) NOT NULL CHECK (target_type IN ('STAFF', 'FLOOR')),
    target_membership_id UUID,
    requested_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED'
        CHECK (status IN (
            'REQUESTED', 'ISSUED', 'REJECTED', 'EMPTY',
            'RETURNED', 'DAMAGED', 'LOST', 'WASTED'
        )),
    request_note TEXT,
    batch_id UUID,
    issued_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    issued_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (target_type = 'STAFF' AND target_membership_id IS NOT NULL)
        OR (target_type = 'FLOOR' AND target_membership_id IS NULL)
    ),
    UNIQUE (id, salon_id),
    FOREIGN KEY (product_id, salon_id)
        REFERENCES salon_products(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (batch_id, salon_id, product_id)
        REFERENCES salon_inventory_batches(id, salon_id, product_id) ON DELETE RESTRICT
);

CREATE INDEX salon_inventory_issue_requests_status_idx
    ON salon_inventory_issue_requests (salon_id, status, created_at DESC);
CREATE INDEX salon_inventory_issue_requests_requester_idx
    ON salon_inventory_issue_requests (salon_id, requested_by_account_id, created_at DESC);

CREATE TABLE salon_inventory_issue_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    request_id UUID NOT NULL,
    event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN (
            'REQUESTED', 'ISSUED', 'REJECTED', 'EMPTY',
            'RETURNED', 'DAMAGED', 'LOST', 'WASTED'
        )),
    actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id, salon_id)
        REFERENCES salon_inventory_issue_requests(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX salon_inventory_issue_events_history_idx
    ON salon_inventory_issue_events (salon_id, request_id, created_at);

CREATE TABLE pos_bill_item_batch_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    bill_id UUID NOT NULL,
    bill_item_id UUID NOT NULL,
    product_id UUID NOT NULL,
    batch_id UUID NOT NULL,
    quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
    expired_override_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (bill_item_id, batch_id),
    FOREIGN KEY (bill_item_id, bill_id, salon_id)
        REFERENCES pos_bill_items(id, bill_id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (batch_id, salon_id, product_id)
        REFERENCES salon_inventory_batches(id, salon_id, product_id) ON DELETE RESTRICT
);

CREATE INDEX pos_bill_item_batch_allocations_bill_idx
    ON pos_bill_item_batch_allocations (bill_id, salon_id);

CREATE TABLE salon_inventory_reminder_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    product_id UUID NOT NULL,
    alert_type VARCHAR(20) NOT NULL CHECK (alert_type = 'LOW_STOCK'),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_notified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,
    UNIQUE (salon_id, product_id, alert_type),
    FOREIGN KEY (product_id, salon_id)
        REFERENCES salon_products(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_inventory_reminder_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL,
    expiry_date DATE NOT NULL,
    lead_days INTEGER NOT NULL CHECK (lead_days IN (7, 30)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (batch_id, expiry_date, lead_days, account_id),
    FOREIGN KEY (batch_id, salon_id)
        REFERENCES salon_inventory_batches(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX salon_inventory_reminder_deliveries_salon_idx
    ON salon_inventory_reminder_deliveries (salon_id, created_at DESC);

COMMIT;
