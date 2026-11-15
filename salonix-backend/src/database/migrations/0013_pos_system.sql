-- Migration: 0013_pos_system.sql
-- Description: Implements the B2C POS system for salon transactions, payments, and tips.

-- 1. POS Bills (The Master Bill)
CREATE TABLE IF NOT EXISTS pos_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    total_amount DECIMAL(12, 2) NOT NULL,
    discount_amount DECIMAL(12, 2) DEFAULT 0,
    final_amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'OPEN', -- OPEN, CLOSED, CANCELLED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT chk_bill_status CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED'))
);

-- 2. POS Bill Items (Services and Products)
CREATE TABLE IF NOT EXISTS pos_bill_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES pos_bills(id) ON DELETE CASCADE,
    item_type VARCHAR(20) NOT NULL, -- 'SERVICE', 'PRODUCT'
    item_id UUID NOT NULL, -- References services(id) or products(id)
    quantity INT DEFAULT 1,
    unit_price DECIMAL(12, 2) NOT NULL,
    total_price DECIMAL(12, 2) NOT NULL,
    stylist_id UUID REFERENCES users(id), -- The stylist who performed the service
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_item_type CHECK (item_type IN ('SERVICE', 'PRODUCT'))
);

-- 3. POS Payments (Split Payment Support)
CREATE TABLE IF NOT EXISTS pos_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES pos_bills(id) ON DELETE CASCADE,
    payment_mode VARCHAR(20) NOT NULL, -- 'CASH', 'UPI', 'CARD', 'PLAN', 'POINTS'
    amount DECIMAL(12, 2) NOT NULL,
    transaction_ref TEXT, -- UPI Transaction ID or Plan ID
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_payment_mode CHECK (payment_mode IN ('CASH', 'UPI', 'CARD', 'PLAN', 'POINTS'))
);

-- 4. POS Tips (The Tip Pool)
CREATE TABLE IF NOT EXISTS pos_tips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES pos_bills(id) ON DELETE CASCADE,
    stylist_id UUID REFERENCES users(id), -- NULL if it's a common pool tip
    amount DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. POS OTP Logs (Security for Plan/Loyalty usage)
CREATE TABLE IF NOT EXISTS pos_otp_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES pos_bills(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    otp_code VARCHAR(10) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pos_bill_status ON pos_bills(status);
CREATE INDEX idx_pos_bill_customer ON pos_bills(customer_id);
CREATE INDEX idx_pos_payments_bill ON pos_payments(bill_id);
CREATE INDEX idx_pos_tips_stylist ON pos_tips(stylist_id);
