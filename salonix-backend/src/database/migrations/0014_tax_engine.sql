-- Migration: 0014_tax_engine.sql
-- Description: Implements granular tax management for separate Service and Product GST/Taxes.

-- 1. Tax Configuration Table
CREATE TABLE IF NOT EXISTS tax_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tax_name VARCHAR(50) NOT NULL, -- e.g., 'GST_SERVICES', 'GST_PRODUCTS'
    tax_type VARCHAR(20) NOT NULL, -- 'SERVICE' or 'PRODUCT'
    rate DECIMAL(5, 2) NOT NULL, -- e.g., 18.00 for 18%
    category_id UUID, -- Optional: link to a specific category for different rates
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_tax_type CHECK (tax_type IN ('SERVICE', 'PRODUCT'))
);

-- 2. Update POS Bill Items to track tax at the item level
-- This ensures that if tax rates change in the future, historical bills are preserved.
ALTER TABLE pos_bill_items
ADD COLUMN tax_rate DECIMAL(5, 2) DEFAULT 0,
ADD COLUMN tax_amount DECIMAL(12, 2) DEFAULT 0;

-- 3. Update POS Bills to track separate totals
ALTER TABLE pos_bills
ADD COLUMN total_service_tax DECIMAL(12, 2) DEFAULT 0,
ADD COLUMN total_product_tax DECIMAL(12, 2) DEFAULT 0;

CREATE INDEX idx_tax_type ON tax_configs(tax_type);
