BEGIN;

CREATE TABLE salon_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    sku VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    base_unit VARCHAR(20) NOT NULL
        CHECK (base_unit IN ('ML', 'GRAM', 'UNIT', 'PACK')),
    current_stock NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    reorder_level NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    cost_price NUMERIC(12, 2) CHECK (cost_price IS NULL OR cost_price >= 0),
    retail_price NUMERIC(12, 2) CHECK (retail_price IS NULL OR retail_price >= 0),
    is_sellable BOOLEAN NOT NULL DEFAULT FALSE,
    is_internal_only BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    UNIQUE (id, salon_id),
    UNIQUE (salon_id, sku)
);

CREATE TABLE salon_product_barcodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    product_id UUID NOT NULL,
    barcode VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (salon_id, barcode),
    FOREIGN KEY (product_id, salon_id)
        REFERENCES salon_products(id, salon_id) ON DELETE CASCADE
);

CREATE TABLE salon_inventory_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    product_id UUID NOT NULL,
    batch_number VARCHAR(100),
    expiry_date DATE,
    initial_quantity NUMERIC(12, 2) NOT NULL CHECK (initial_quantity >= 0),
    current_quantity NUMERIC(12, 2) NOT NULL CHECK (current_quantity >= 0),
    cost_per_unit NUMERIC(12, 2) CHECK (cost_per_unit IS NULL OR cost_per_unit >= 0),
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (current_quantity <= initial_quantity),
    FOREIGN KEY (product_id, salon_id)
        REFERENCES salon_products(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_inventory_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    product_id UUID NOT NULL,
    batch_id UUID,
    quantity_change NUMERIC(12, 2) NOT NULL CHECK (quantity_change <> 0),
    reason VARCHAR(30) NOT NULL
        CHECK (reason IN ('RETAIL_SALE', 'SERVICE_USE', 'EXPIRY', 'RESTOCK', 'ADJUSTMENT', 'RETURN')),
    reference_id UUID,
    created_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id, salon_id)
        REFERENCES salon_products(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (batch_id)
        REFERENCES salon_inventory_batches(id) ON DELETE RESTRICT
);

CREATE TABLE salon_service_consumables (
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity_required NUMERIC(12, 2) NOT NULL CHECK (quantity_required > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (service_id, product_id),
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id, salon_id)
        REFERENCES salon_products(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX salon_inventory_batches_fifo_idx
    ON salon_inventory_batches (salon_id, product_id, expiry_date, received_at);
CREATE INDEX salon_inventory_ledger_product_idx
    ON salon_inventory_ledger (salon_id, product_id, created_at);

COMMIT;
