-- Migration: 009_inventory_consumables.sql
-- Description: Implements optional product tracking for services (Inventory/Consumables)
-- Designed to be non-blocking; services work normally even without product links.

-- 1. Product Catalog
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100), -- e.g., 'Shampoo', 'Facial Kit', 'Color'

    -- Unit System
    base_unit VARCHAR(20) NOT NULL, -- 'ML', 'GRAM', 'UNIT', 'PACK'
    current_stock DECIMAL(12, 2) DEFAULT 0,
    reorder_level DECIMAL(12, 2) DEFAULT 10, -- Alert when stock falls below this

    -- Pricing
    cost_price DECIMAL(12, 2), -- What the salon pays
    retail_price DECIMAL(12, 2), -- What the customer pays (if sold)

    -- Sales Config
    is_sellable BOOLEAN DEFAULT FALSE, -- True if it can be sold as a retail product
    is_internal_only BOOLEAN DEFAULT TRUE, -- True if it's only for service consumption

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_unit CHECK (base_unit IN ('ML', 'GRAM', 'UNIT', 'PACK'))
);

-- 2. Service-Consumable Mapping (The Optional Link)
CREATE TABLE IF NOT EXISTS service_consumables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_required DECIMAL(12, 2) NOT NULL, -- Amount used per service (e.g., 20.00 for 20ml)

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

-- Indices
CREATE INDEX idx_consumables_service ON service_consumables(service_id);
CREATE INDEX idx_consumables_product ON service_consumables(product_id);
CREATE INDEX idx_products_stock ON products(current_stock);
