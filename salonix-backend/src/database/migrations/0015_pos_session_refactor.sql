-- Migration: 0015_pos_session_refactor.sql
-- Description: Refactors POS from Single Bill to Session-Based (One Payment, Multiple Bills)
-- This allows separate invoices for Services and Products while keeping one payment.

-- 1. POS Billing Sessions (The master container for a visit)
CREATE TABLE IF NOT EXISTS pos_billing_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    session_total DECIMAL(12, 2) DEFAULT 0,
    payment_status VARCHAR(20) DEFAULT 'OPEN', -- OPEN, PAID, PARTIAL, CANCELLED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT chk_session_status CHECK (payment_status IN ('OPEN', 'PAID', 'PARTIAL', 'CANCELLED'))
);

-- 2. Update POS Bills to link to a Session
-- We add session_id to link multiple bills (Service Bill, Product Bill) to one visit.
ALTER TABLE pos_bills
ADD COLUMN session_id UUID REFERENCES pos_billing_sessions(id) ON DELETE CASCADE;

-- 3. Update POS Payments to link to Session instead of a single Bill
-- This allows one payment to cover both Service and Product bills.
ALTER TABLE pos_payments
ADD COLUMN session_id UUID REFERENCES pos_billing_sessions(id) ON DELETE CASCADE;

-- 4. Update POS Tips to link to Session
ALTER TABLE pos_tips
ADD COLUMN session_id UUID REFERENCES pos_billing_sessions(id) ON DELETE CASCADE;

-- 5. Update POS OTP Logs to link to Session
ALTER TABLE pos_otp_logs
ADD COLUMN session_id UUID REFERENCES pos_billing_sessions(id) ON DELETE CASCADE;

-- Indices for performance
CREATE INDEX idx_pos_session_customer ON pos_billing_sessions(customer_id);
CREATE INDEX idx_pos_bill_session ON pos_bills(session_id);
CREATE INDEX idx_pos_payment_session ON pos_payments(session_id);
