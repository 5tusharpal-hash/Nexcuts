-- Migration: 006_platform_billing_b2b.sql
-- Description: Implements the B2B SaaS Billing system (Platform -> Salon Owner)
-- Using "Grocery Store" model: Consolidated Bill, Distributed Invoices.

-- 1. Platform Subscription Plans
CREATE TABLE IF NOT EXISTS platform_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL, -- e.g., 'Basic', 'Pro', 'Enterprise'
    monthly_rate DECIMAL(12, 2) NOT NULL,
    features JSONB, -- Feature flags for this plan
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Account Billing Configuration (The Anchor)
CREATE TABLE IF NOT EXISTS platform_account_billing (
    account_id UUID PRIMARY KEY REFERENCES accounts(id),
    anchor_date INT NOT NULL DEFAULT 1, -- Day of the month for consolidated billing (1-31)
    current_plan_id UUID REFERENCES platform_plans(id),
    billing_cycle_start TIMESTAMP WITH TIME ZONE,
    payment_method_token TEXT, -- Token for Autopay
    autopay_enabled BOOLEAN DEFAULT FALSE,
    is_trial_active BOOLEAN DEFAULT FALSE,
    trial_started_at TIMESTAMP WITH TIME ZONE,
    trial_ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Branch-level Subscription (The Distributed part)
CREATE TABLE IF NOT EXISTS platform_branch_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PAUSED, CANCELLED
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_billed_at TIMESTAMP WITH TIME ZONE,
    gst_number TEXT,
    state_code VARCHAR(10), -- For multi-state tax logic
    is_trial_eligible BOOLEAN DEFAULT TRUE,
    CONSTRAINT chk_branch_status CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED'))
);

-- 4. Consolidated Bills (The Payment)
CREATE TABLE IF NOT EXISTS platform_consolidated_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    total_amount DECIMAL(12, 2) NOT NULL,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, PAID, FAILED, PARTIAL
    payment_date TIMESTAMP WITH TIME ZONE,
    billing_period_start TIMESTAMP WITH TIME ZONE,
    billing_period_end TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_pay_status CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'PARTIAL'))
);

-- 5. Distributed Invoices (The Receipts/Tax Docs)
CREATE TABLE IF NOT EXISTS platform_branch_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES platform_consolidated_bills(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    amount_exclusive_tax DECIMAL(12, 2) NOT NULL,
    tax_amount DECIMAL(12, 2) NOT NULL,
    total_amount DECIMAL(12, 2) NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Platform Add-ons (Billable items regardless of Trial)
CREATE TABLE IF NOT EXISTS platform_add_ons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    is_recurring BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS platform_branch_add_ons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    add_on_id UUID NOT NULL REFERENCES platform_add_ons(id),
    activated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

-- Indices
CREATE INDEX idx_plat_bill_acc ON platform_consolidated_bills(account_id);
CREATE INDEX idx_plat_inv_bill ON platform_branch_invoices(bill_id);
CREATE INDEX idx_plat_sub_branch ON platform_branch_subscriptions(branch_id);
