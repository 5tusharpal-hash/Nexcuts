BEGIN;

CREATE TABLE platform_plan_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    monthly_price NUMERIC(12, 2) NOT NULL CHECK (monthly_price >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE platform_plan_features (
    plan_id UUID NOT NULL REFERENCES platform_plan_catalog(id) ON DELETE CASCADE,
    feature_key VARCHAR(100) NOT NULL,
    feature_value JSONB NOT NULL DEFAULT 'true'::jsonb,
    PRIMARY KEY (plan_id, feature_key)
);

CREATE TABLE platform_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    is_recurring BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE platform_organization_billing (
    organization_id UUID PRIMARY KEY REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    anchor_day SMALLINT NOT NULL DEFAULT 1 CHECK (anchor_day BETWEEN 1 AND 31),
    current_plan_id UUID REFERENCES platform_plan_catalog(id) ON DELETE RESTRICT,
    trial_days_remaining INTEGER NOT NULL DEFAULT 0 CHECK (trial_days_remaining >= 0),
    trial_started_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    autopay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    payment_method_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE platform_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL,
    plan_id UUID NOT NULL REFERENCES platform_plan_catalog(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'PAUSED', 'PENDING_PAYMENT', 'CANCELLED')),
    billing_cycle_start DATE NOT NULL,
    billing_cycle_end DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (billing_cycle_end >= billing_cycle_start),
    FOREIGN KEY (salon_id, organization_id)
        REFERENCES salons(id, organization_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX platform_subscriptions_one_active_per_salon_idx
    ON platform_subscriptions (salon_id)
    WHERE status IN ('ACTIVE', 'PENDING_PAYMENT');

CREATE TABLE platform_salon_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    addon_id UUID NOT NULL REFERENCES platform_addons(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'CANCELLED')),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cancelled_at TIMESTAMPTZ,
    UNIQUE (salon_id, addon_id)
);

CREATE TABLE platform_salon_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL,
    invoice_number VARCHAR(100) NOT NULL UNIQUE,
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    gst_number VARCHAR(50),
    subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'UNPAID'
        CHECK (status IN ('UNPAID', 'PAID', 'PARTIAL', 'VOID', 'REFUNDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,
    CHECK (billing_period_end >= billing_period_start),
    FOREIGN KEY (salon_id, organization_id)
        REFERENCES salons(id, organization_id) ON DELETE RESTRICT,
    UNIQUE (id, organization_id),
    UNIQUE (salon_id, billing_period_start, billing_period_end)
);

CREATE TABLE platform_salon_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES platform_salon_invoices(id) ON DELETE CASCADE,
    item_type VARCHAR(30) NOT NULL
        CHECK (item_type IN ('BASE_PLAN', 'ADDON', 'PRORATION', 'CREDIT')),
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE platform_consolidated_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'PARTIAL', 'VOID')),
    billing_period_start DATE,
    billing_period_end DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,
    CHECK (billing_period_end IS NULL OR billing_period_start IS NULL OR billing_period_end >= billing_period_start),
    UNIQUE (id, organization_id)
);

CREATE TABLE platform_consolidated_bill_invoices (
    consolidated_bill_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    invoice_id UUID NOT NULL,
    amount_applied NUMERIC(12, 2) NOT NULL CHECK (amount_applied >= 0),
    PRIMARY KEY (consolidated_bill_id, invoice_id),
    FOREIGN KEY (consolidated_bill_id, organization_id)
        REFERENCES platform_consolidated_bills(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (invoice_id, organization_id)
        REFERENCES platform_salon_invoices(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE platform_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consolidated_bill_id UUID NOT NULL REFERENCES platform_consolidated_bills(id) ON DELETE RESTRICT,
    provider_reference VARCHAR(255) UNIQUE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(40),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

CREATE TABLE platform_financial_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    salon_id UUID REFERENCES salons(id) ON DELETE RESTRICT,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('CREDIT', 'DEBIT')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    invoice_id UUID REFERENCES platform_salon_invoices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salon_id, organization_id)
        REFERENCES salons(id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX platform_salon_invoices_status_idx
    ON platform_salon_invoices (organization_id, status, created_at);
CREATE INDEX platform_consolidated_bills_org_idx
    ON platform_consolidated_bills (organization_id, created_at DESC);

COMMIT;
