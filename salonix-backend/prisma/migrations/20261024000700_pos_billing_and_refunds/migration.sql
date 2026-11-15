BEGIN;

CREATE TABLE pos_billing_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    booking_id UUID,
    booking_group_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'PAID', 'PARTIAL', 'CANCELLED', 'REFUNDED')),
    session_total NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (session_total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ,
    UNIQUE (id, salon_id),
    FOREIGN KEY (booking_id, salon_id, customer_account_id)
        REFERENCES customer_bookings(id, salon_id, customer_account_id) ON DELETE RESTRICT,
    FOREIGN KEY (booking_group_id, salon_id)
        REFERENCES booking_groups(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE pos_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    invoice_number VARCHAR(100) NOT NULL UNIQUE,
    bill_type VARCHAR(20) NOT NULL DEFAULT 'SERVICE'
        CHECK (bill_type IN ('SERVICE', 'PRODUCT', 'COMBINED')),
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    service_tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (service_tax_amount >= 0),
    product_tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (product_tax_amount >= 0),
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED', 'REFUNDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ,
    UNIQUE (id, salon_id),
    FOREIGN KEY (session_id, salon_id)
        REFERENCES pos_billing_sessions(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE pos_bill_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('SERVICE', 'PRODUCT')),
    service_id UUID,
    product_id UUID,
    quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    is_covered_by_plan BOOLEAN NOT NULL DEFAULT FALSE,
    staff_membership_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (item_type = 'SERVICE' AND service_id IS NOT NULL AND product_id IS NULL)
        OR (item_type = 'PRODUCT' AND product_id IS NOT NULL AND service_id IS NULL)
    ),
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, salon_id)
        REFERENCES salon_products(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (staff_membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE pos_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    payment_mode VARCHAR(20) NOT NULL
        CHECK (payment_mode IN ('CASH', 'UPI', 'CARD', 'PLAN', 'POINTS', 'CREDIT')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    transaction_reference VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS'
        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    FOREIGN KEY (session_id, salon_id)
        REFERENCES pos_billing_sessions(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE pos_tips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    staff_membership_id UUID,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id, salon_id)
        REFERENCES pos_billing_sessions(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (staff_membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_tax_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('SERVICE', 'PRODUCT')),
    rate NUMERIC(5, 2) NOT NULL CHECK (rate BETWEEN 0 AND 100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id)
);

CREATE TABLE pos_credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    reason VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ISSUED'
        CHECK (status IN ('ISSUED', 'REDEEMED', 'EXPIRED', 'VOID')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE customer_salon_credits (
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_account_id, salon_id)
);

CREATE TABLE pos_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    payment_id UUID,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    reason VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (payment_id, salon_id)
        REFERENCES pos_payments(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE pos_otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES pos_billing_sessions(id) ON DELETE RESTRICT,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX pos_billing_sessions_customer_idx
    ON pos_billing_sessions (customer_account_id, created_at DESC);
CREATE INDEX pos_bills_session_idx ON pos_bills (session_id);
CREATE INDEX pos_bill_items_bill_idx ON pos_bill_items (bill_id);
CREATE INDEX pos_payments_session_idx ON pos_payments (session_id);
CREATE INDEX pos_credit_notes_customer_idx
    ON pos_credit_notes (customer_account_id, status);

ALTER TABLE customer_loyalty_ledger
    ADD CONSTRAINT customer_loyalty_ledger_bill_fk
    FOREIGN KEY (transaction_reference)
    REFERENCES pos_bills(id) ON DELETE RESTRICT;

COMMIT;
