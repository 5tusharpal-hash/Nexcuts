BEGIN;

ALTER TABLE pos_billing_sessions
    ADD COLUMN queue_entry_id UUID,
    ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'QUEUE'
        CHECK (origin IN ('QUEUE', 'WALK_IN', 'OFFLINE_SALE'));

ALTER TABLE pos_billing_sessions
    ADD CONSTRAINT pos_billing_sessions_queue_entry_fk
        FOREIGN KEY (queue_entry_id, salon_id)
        REFERENCES queue_entries(id, salon_id) ON DELETE RESTRICT;

ALTER TABLE pos_bills
    ADD COLUMN workflow_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (workflow_status IN ('DRAFT', 'ISSUED', 'CONFIRMED', 'CANCELLED', 'REFUNDED')),
    ADD COLUMN current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
    ADD COLUMN confirmed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD COLUMN confirmed_at TIMESTAMPTZ,
    ADD COLUMN offer_tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (offer_tax_amount >= 0),
    ADD COLUMN refund_window_days INTEGER NOT NULL DEFAULT 7 CHECK (refund_window_days >= 0);

ALTER TABLE pos_bills
    DROP CONSTRAINT pos_bills_bill_type_check,
    ADD CONSTRAINT pos_bills_bill_type_check
        CHECK (bill_type IN ('SERVICE', 'PRODUCT', 'COMBINED', 'OFFER'));

UPDATE pos_bills
SET workflow_status = CASE
    WHEN status = 'CANCELLED' THEN 'CANCELLED'
    WHEN status = 'REFUNDED' THEN 'REFUNDED'
    WHEN status = 'CLOSED' THEN 'CONFIRMED'
    ELSE 'DRAFT'
END;

ALTER TABLE pos_bill_items
    ADD COLUMN parent_bill_item_id UUID,
    ADD COLUMN package_id UUID,
    ADD COLUMN combo_id UUID,
    ADD COLUMN offer_purchase_request_id UUID,
    ADD COLUMN description TEXT,
    ADD COLUMN discount_type VARCHAR(12),
    ADD COLUMN discount_value NUMERIC(12, 2),
    ADD COLUMN discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (discount_amount >= 0),
    ADD COLUMN tax_category VARCHAR(20) NOT NULL DEFAULT 'SERVICE'
        CHECK (tax_category IN ('SERVICE', 'PRODUCT', 'PACKAGE', 'COMBO', 'CONSUMABLE')),
    ADD COLUMN tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN tax_override_reason VARCHAR(1000),
    ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    ADD COLUMN removed_at TIMESTAMPTZ,
    ADD COLUMN removed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD CONSTRAINT pos_bill_items_id_salon_unique UNIQUE (id, salon_id),
    ADD CONSTRAINT pos_bill_items_id_bill_salon_unique UNIQUE (id, bill_id, salon_id),
    DROP CONSTRAINT pos_bill_items_item_type_check,
    DROP CONSTRAINT pos_bill_items_check,
    ADD CONSTRAINT pos_bill_items_item_type_check
        CHECK (item_type IN ('SERVICE', 'PRODUCT', 'PACKAGE', 'COMBO')),
    ADD CONSTRAINT pos_bill_items_reference_check
        CHECK (
            (item_type = 'SERVICE' AND service_id IS NOT NULL AND product_id IS NULL
                AND package_id IS NULL AND combo_id IS NULL
                AND offer_purchase_request_id IS NULL)
            OR (item_type = 'PRODUCT' AND product_id IS NOT NULL AND service_id IS NULL
                AND package_id IS NULL AND combo_id IS NULL
                AND offer_purchase_request_id IS NULL)
            OR (item_type = 'PACKAGE' AND package_id IS NOT NULL AND service_id IS NULL
                AND product_id IS NULL AND combo_id IS NULL
                AND offer_purchase_request_id IS NOT NULL)
            OR (item_type = 'COMBO' AND combo_id IS NOT NULL AND service_id IS NULL
                AND product_id IS NULL AND package_id IS NULL
                AND offer_purchase_request_id IS NOT NULL)
        ),
    ADD CONSTRAINT pos_bill_items_discount_type_check
        CHECK (discount_type IS NULL OR discount_type IN ('PERCENT', 'FIXED')),
    ADD CONSTRAINT pos_bill_items_discount_value_check
        CHECK (discount_value IS NULL OR discount_value >= 0),
    ADD CONSTRAINT pos_bill_items_discount_amount_limit_check
        CHECK (discount_amount <= subtotal),
    ADD CONSTRAINT pos_bill_items_parent_fk
        FOREIGN KEY (parent_bill_item_id, bill_id, salon_id)
        REFERENCES pos_bill_items(id, bill_id, salon_id) ON DELETE RESTRICT,
    ADD CONSTRAINT pos_bill_items_package_fk
        FOREIGN KEY (package_id, salon_id)
        REFERENCES salon_packages(id, salon_id) ON DELETE RESTRICT,
    ADD CONSTRAINT pos_bill_items_combo_fk
        FOREIGN KEY (combo_id, salon_id)
        REFERENCES salon_service_combos(id, salon_id) ON DELETE RESTRICT,
    ADD CONSTRAINT pos_bill_items_offer_request_fk
        FOREIGN KEY (offer_purchase_request_id, salon_id)
        REFERENCES salon_offer_purchase_requests(id, salon_id) ON DELETE RESTRICT;

UPDATE pos_bill_items
SET tax_category = 'PRODUCT'
WHERE item_type = 'PRODUCT';

ALTER TABLE salon_tax_rates
    DROP CONSTRAINT salon_tax_rates_item_type_check,
    ADD CONSTRAINT salon_tax_rates_item_type_check
        CHECK (item_type IN ('SERVICE', 'PRODUCT', 'PACKAGE', 'COMBO', 'CONSUMABLE'));

CREATE TABLE pos_bill_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'CURRENT'
        CHECK (status IN ('CURRENT', 'SUPERSEDED', 'CONFIRMED')),
    invoice_number VARCHAR(100) NOT NULL UNIQUE,
    snapshot JSONB NOT NULL,
    created_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    UNIQUE (bill_id, version_number),
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX pos_bill_versions_history_idx
    ON pos_bill_versions (salon_id, bill_id, issued_at DESC);

INSERT INTO pos_bill_versions (
    bill_id, salon_id, version_number, status, invoice_number, snapshot
)
SELECT
    bill.id,
    bill.salon_id,
    1,
    'CONFIRMED',
    bill.invoice_number,
    jsonb_build_object(
        'billId', bill.id,
        'salonId', bill.salon_id,
        'invoiceNumber', bill.invoice_number,
        'invoiceType', 'FINAL',
        'version', 1,
        'totals', jsonb_build_object(
            'subtotal', bill.subtotal,
            'discountAmount', bill.discount_amount,
            'serviceTaxAmount', bill.service_tax_amount,
            'productTaxAmount', bill.product_tax_amount,
            'totalAmount', bill.total_amount
        ),
        'items', COALESCE((
            SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at)
            FROM pos_bill_items AS item
            WHERE item.bill_id = bill.id AND item.salon_id = bill.salon_id
        ), '[]'::jsonb)
    )
FROM pos_bills AS bill
WHERE bill.status = 'CLOSED';

UPDATE pos_bills
SET current_version = 1
WHERE status = 'CLOSED';

CREATE TABLE pos_bill_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    event_type VARCHAR(30) NOT NULL
        CHECK (event_type IN (
            'CREATED', 'EDITED', 'VERSION_ISSUED', 'CONFIRMED',
            'PAYMENT_RECORDED', 'PAYMENT_APPROVED', 'WALLET_APPROVED',
            'REFUND_ISSUED', 'REFUND_COMPLETED', 'CANCELLED'
        )),
    actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX pos_bill_events_history_idx
    ON pos_bill_events (bill_id, salon_id, created_at DESC);

ALTER TABLE pos_payments
    ADD COLUMN bill_id UUID,
    ADD COLUMN source_type VARCHAR(24) NOT NULL DEFAULT 'SALON_RECORDED'
        CHECK (source_type IN (
            'SALON_RECORDED', 'CUSTOMER_CLAIM', 'PACKAGE', 'COMBO',
            'LOYALTY', 'ADVANCE', 'CREDIT_NOTE'
        )),
    ADD COLUMN recorded_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD COLUMN approved_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD COLUMN idempotency_key VARCHAR(255);

ALTER TABLE pos_payments
    DROP CONSTRAINT pos_payments_payment_mode_check,
    ADD CONSTRAINT pos_payments_payment_mode_check
        CHECK (payment_mode IN ('CASH', 'UPI', 'CARD', 'OTHER', 'PLAN', 'POINTS', 'CREDIT'));

ALTER TABLE pos_payments
    ADD CONSTRAINT pos_payments_bill_fk
        FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT,
    ADD CONSTRAINT pos_payments_idempotency_unique
        UNIQUE (salon_id, idempotency_key);

UPDATE pos_payments AS payment
SET bill_id = bill.id
FROM pos_bills AS bill
WHERE bill.session_id = payment.session_id
  AND bill.salon_id = payment.salon_id
  AND (
      SELECT COUNT(*)
      FROM pos_bills AS session_bill
      WHERE session_bill.session_id = payment.session_id
        AND session_bill.salon_id = payment.salon_id
  ) = 1;

CREATE INDEX pos_payments_bill_status_idx
    ON pos_payments (bill_id, status, paid_at DESC);

CREATE TABLE pos_payment_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    bill_id UUID,
    bill_version_id UUID,
    claim_type VARCHAR(20) NOT NULL CHECK (claim_type IN ('BILL_PAYMENT', 'ADVANCE')),
    payment_mode VARCHAR(20) NOT NULL CHECK (payment_mode IN ('UPI', 'CASH', 'CARD', 'OTHER')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    transaction_reference VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'STALE')),
    reason TEXT,
    created_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ,
    UNIQUE (salon_id, idempotency_key),
    UNIQUE (id, salon_id),
    CHECK (
        (claim_type = 'BILL_PAYMENT' AND bill_id IS NOT NULL AND bill_version_id IS NOT NULL)
        OR (claim_type = 'ADVANCE' AND bill_id IS NULL AND bill_version_id IS NULL)
    ),
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (bill_version_id, salon_id)
        REFERENCES pos_bill_versions(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX pos_payment_claims_salon_status_idx
    ON pos_payment_claims (salon_id, status, created_at DESC);
CREATE INDEX pos_payment_claims_customer_idx
    ON pos_payment_claims (customer_account_id, salon_id, created_at DESC);

CREATE TABLE pos_payment_claim_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_claim_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('APPROVED', 'REJECTED', 'REAPPROVED')),
    actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (payment_claim_id, salon_id)
        REFERENCES pos_payment_claims(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX pos_payment_claim_events_history_idx
    ON pos_payment_claim_events (payment_claim_id, created_at DESC);

CREATE TABLE pos_payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    event_type VARCHAR(24) NOT NULL
        CHECK (event_type IN ('RECORDED', 'APPROVED', 'REJECTED', 'REAPPROVED', 'REFUNDED')),
    actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (payment_id, salon_id)
        REFERENCES pos_payments(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX pos_payment_events_payment_idx
    ON pos_payment_events (payment_id, created_at);

CREATE TABLE pos_customer_advance_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    payment_claim_id UUID NOT NULL UNIQUE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    remaining_amount NUMERIC(12, 2) NOT NULL CHECK (remaining_amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'REVERSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (remaining_amount <= amount),
    FOREIGN KEY (payment_claim_id, salon_id)
        REFERENCES pos_payment_claims(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX pos_customer_advances_available_idx
    ON pos_customer_advance_entries (customer_account_id, salon_id, status, created_at);

CREATE TABLE pos_advance_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    advance_entry_id UUID NOT NULL,
    bill_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    idempotency_key VARCHAR(255) NOT NULL,
    allocated_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (salon_id, idempotency_key),
    FOREIGN KEY (advance_entry_id)
        REFERENCES pos_customer_advance_entries(id) ON DELETE RESTRICT,
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX pos_advance_allocations_bill_idx
    ON pos_advance_allocations (bill_id, created_at);

CREATE TABLE pos_wallet_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    bill_id UUID NOT NULL,
    bill_version_id UUID NOT NULL,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    allocation JSONB NOT NULL,
    authorization_hash VARCHAR(64) NOT NULL,
    otp_hash VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'OTP_PENDING'
        CHECK (status IN (
            'OTP_PENDING', 'OTP_VERIFIED', 'APPROVED', 'REJECTED', 'EXPIRED', 'RELEASED'
        )),
    review_reason TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    verify_attempts INTEGER NOT NULL DEFAULT 0 CHECK (verify_attempts >= 0),
    verified_at TIMESTAMPTZ,
    approved_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (salon_id, idempotency_key),
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (bill_version_id, salon_id)
        REFERENCES pos_bill_versions(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX pos_wallet_redemptions_pending_idx
    ON pos_wallet_redemptions (customer_account_id, salon_id, status, expires_at);

CREATE TABLE salon_pos_category_settings (
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    category VARCHAR(20) NOT NULL
        CHECK (category IN ('SERVICE', 'PRODUCT', 'PACKAGE', 'COMBO', 'CONSUMABLE')),
    tax_mode VARCHAR(12) NOT NULL DEFAULT 'EXCLUSIVE'
        CHECK (tax_mode IN ('INCLUSIVE', 'EXCLUSIVE')),
    allow_package BOOLEAN NOT NULL DEFAULT FALSE,
    allow_combo BOOLEAN NOT NULL DEFAULT FALSE,
    allow_loyalty BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (salon_id, category)
);

CREATE TABLE pos_bill_category_overrides (
    bill_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    category VARCHAR(20) NOT NULL
        CHECK (category IN ('SERVICE', 'PRODUCT', 'PACKAGE', 'COMBO', 'CONSUMABLE')),
    allow_package BOOLEAN NOT NULL,
    allow_combo BOOLEAN NOT NULL,
    allow_loyalty BOOLEAN NOT NULL,
    reason VARCHAR(1000) NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
    updated_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (bill_id, category),
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE pos_category_setting_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    category VARCHAR(20) NOT NULL,
    before_state JSONB,
    after_state JSONB NOT NULL,
    reason VARCHAR(1000) NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
    actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salon_id, category)
        REFERENCES salon_pos_category_settings(salon_id, category) ON DELETE RESTRICT
);

CREATE INDEX pos_category_setting_events_history_idx
    ON pos_category_setting_events (salon_id, category, created_at DESC);

CREATE TABLE pos_bill_category_override_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    category VARCHAR(20) NOT NULL,
    before_state JSONB,
    after_state JSONB NOT NULL,
    reason VARCHAR(1000) NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
    actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id, category)
        REFERENCES pos_bill_category_overrides(bill_id, category) ON DELETE RESTRICT,
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX pos_bill_category_override_events_history_idx
    ON pos_bill_category_override_events (bill_id, category, created_at DESC);

ALTER TABLE pos_credit_notes
    ADD COLUMN issued_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD COLUMN refund_window_expires_at TIMESTAMPTZ,
    ADD COLUMN idempotency_key VARCHAR(255);

CREATE UNIQUE INDEX pos_credit_notes_idempotency_idx
    ON pos_credit_notes (salon_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE pos_refunds
    ADD COLUMN credit_note_id UUID REFERENCES pos_credit_notes(id) ON DELETE RESTRICT,
    ADD COLUMN requested_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD COLUMN completed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD COLUMN idempotency_key VARCHAR(255);

CREATE UNIQUE INDEX pos_refunds_idempotency_idx
    ON pos_refunds (salon_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMIT;
