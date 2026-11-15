-- Migration: 0021_refunds_credit_notes.sql
-- Description: Implements Credit Notes and User Credit balances for professional accounting.

-- 1. Credit Notes Table (The Legal Document for Refund)
CREATE TABLE IF NOT EXISTS credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID REFERENCES bills(id),
    user_id UUID NOT NULL REFERENCES users(id),
    amount DECIMAL(12, 2) NOT NULL,
    reason VARCHAR(50) NOT NULL, -- 'SERVICE_ISSUE', 'BRANCH_PAUSE', 'CUSTOMER_REQUEST', 'ERROR'
    status VARCHAR(20) DEFAULT 'ISSUED', -- 'ISSUED', 'REDEEMED', 'EXPIRED'
    expiry_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. User Credits Table (The Wallet for fast redemption)
CREATE TABLE IF NOT EXISTS user_credits (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    balance DECIMAL(12, 2) DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indices
CREATE INDEX idx_credit_notes_user ON credit_notes(user_id);
CREATE INDEX idx_credit_notes_status ON credit_notes(status);
