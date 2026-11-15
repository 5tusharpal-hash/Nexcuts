-- Migration: 0020_pos_billing_integration.sql
-- Description: Creates the professional B2C billing tables and connects them to the queue and inventory.

-- 1. Bills Table (B2C - Salon to Customer)
CREATE TABLE IF NOT EXISTS bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    salon_id UUID NOT NULL REFERENCES salons(id),
    queue_entry_id UUID REFERENCES queue_entries(id), -- Link to the actual service performed
    total_amount DECIMAL(12, 2) NOT NULL,
    discount_amount DECIMAL(12, 2) DEFAULT 0,
    tax_amount DECIMAL(12, 2) DEFAULT 0,
    final_amount DECIMAL(12, 2) NOT NULL,
    payment_status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, PAID, PARTIAL, REFUNDED
    payment_method VARCHAR(20), -- CASH, CARD, UPI, PACKAGE, POINTS
    invoice_number VARCHAR(100) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bill Items (Individual services/products in a bill)
CREATE TABLE IF NOT EXISTS bill_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id),
    product_id UUID REFERENCES products(id), -- For retail sales
    quantity DECIMAL(12, 2) DEFAULT 1,
    unit_price DECIMAL(12, 2) NOT NULL,
    subtotal DECIMAL(12, 2) NOT NULL,
    is_covered_by_plan BOOLEAN DEFAULT FALSE, -- True if paid via Membership
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indices for Performance
CREATE INDEX idx_bills_user ON bills(user_id);
CREATE INDEX idx_bills_salon ON bills(salon_id);
CREATE INDEX idx_bills_queue ON bills(queue_entry_id);
CREATE INDEX idx_bill_items_bill ON bill_items(bill_id);
