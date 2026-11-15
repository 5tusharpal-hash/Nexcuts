BEGIN;

CREATE TABLE platform_gst_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    seller_gstin VARCHAR(15),
    seller_state_code CHAR(2),
    rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
        CHECK (rate_percent BETWEEN 0 AND 28),
    updated_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (is_enabled = FALSE)
        OR (
            seller_gstin IS NOT NULL
            AND seller_state_code IS NOT NULL
            AND seller_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
            AND seller_state_code ~ '^[0-9]{2}$'
            AND left(seller_gstin, 2) = seller_state_code
            AND rate_percent > 0
        )
    )
);

CREATE TABLE salon_billing_profiles (
    salon_id UUID PRIMARY KEY REFERENCES salons(id) ON DELETE CASCADE,
    gstin VARCHAR(15),
    state_code CHAR(2) NOT NULL CHECK (state_code ~ '^[0-9]{2}$'),
    updated_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        gstin IS NULL
        OR (
            gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
            AND left(gstin, 2) = state_code
        )
    )
);

ALTER TABLE platform_salon_invoices
    ADD COLUMN seller_gstin VARCHAR(15),
    ADD COLUMN seller_state_code CHAR(2),
    ADD COLUMN buyer_state_code CHAR(2),
    ADD COLUMN tax_type VARCHAR(12) NOT NULL DEFAULT 'NONE'
        CHECK (tax_type IN ('NONE', 'CGST_SGST', 'IGST')),
    ADD COLUMN cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
    ADD COLUMN sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
    ADD COLUMN igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'INR';

ALTER TABLE platform_payments
    ADD COLUMN provider VARCHAR(20)
        CHECK (provider IN ('RAZORPAY', 'STRIPE')),
    ADD COLUMN checkout_url TEXT,
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'INR',
    ADD COLUMN expires_at TIMESTAMPTZ;

CREATE TABLE platform_payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('RAZORPAY', 'STRIPE')),
    event_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(120) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, event_id)
);

CREATE TABLE salon_marketing_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE CASCADE,
    consent_scope VARCHAR(20) NOT NULL CHECK (consent_scope IN ('ALL', 'EMAIL', 'WHATSAPP')),
    is_granted BOOLEAN NOT NULL,
    source VARCHAR(24) NOT NULL CHECK (source IN ('QUEUE_ENTRY', 'CUSTOMER_SETTINGS')),
    consent_text_version VARCHAR(40) NOT NULL,
    queue_entry_id UUID REFERENCES queue_entries(id) ON DELETE SET NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX salon_marketing_consents_current_idx
    ON salon_marketing_consents (salon_id, customer_account_id, consent_scope, recorded_at DESC);

ALTER TABLE salon_marketing_deliveries
    DROP CONSTRAINT salon_marketing_deliveries_status_check,
    ADD CONSTRAINT salon_marketing_deliveries_status_check
        CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ')),
    DROP CONSTRAINT salon_marketing_deliveries_channel_check,
    ADD CONSTRAINT salon_marketing_deliveries_channel_check
        CHECK (channel IN ('IN_APP', 'WHATSAPP', 'SMS', 'EMAIL', 'PUSH')),
    ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    ADD COLUMN last_attempt_at TIMESTAMPTZ,
    ADD COLUMN last_error TEXT,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX salon_marketing_deliveries_retry_idx
    ON salon_marketing_deliveries (campaign_id, status, updated_at);

COMMIT;
