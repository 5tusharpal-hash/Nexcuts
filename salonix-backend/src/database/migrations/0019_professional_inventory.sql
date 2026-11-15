-- Migration: 0019_professional_inventory.sql
-- Description: Implements Professional Inventory with Batch Tracking, FIFO, and Barcode Support.

-- 1. Product Barcodes
CREATE TABLE IF NOT EXISTS product_barcodes (
    barcode VARCHAR(100) PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Inventory Batches (The "Professional" tracking layer)
CREATE TABLE IF NOT EXISTS inventory_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    batch_number VARCHAR(100),
    expiry_date TIMESTAMP WITH TIME ZONE,
    initial_quantity DECIMAL(12, 2) NOT NULL,
    current_quantity DECIMAL(12, 2) NOT NULL,
    cost_per_unit DECIMAL(12, 2), -- Tracking cost for specific batches
    received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_qty CHECK (current_quantity >= 0)
);

-- 3. Inventory Ledger (Audit trail of every single ML or Unit)
CREATE TABLE IF NOT EXISTS inventory_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id),
    batch_id UUID REFERENCES inventory_batches(id),
    change_amount DECIMAL(12, 2) NOT NULL, -- Positive for arrival, negative for use/sale
    reason VARCHAR(50) NOT NULL, -- 'RETAIL_SALE', 'SERVICE_USE', 'EXPIRY', 'RESTOCK', 'ADJUSTMENT'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indices for FIFO and Expiry tracking
CREATE INDEX idx_batch_expiry ON inventory_batches(expiry_date);
CREATE INDEX idx_batch_product ON inventory_batches(product_id);
CREATE INDEX idx_barcode_prod ON product_barcodes(product_id);
