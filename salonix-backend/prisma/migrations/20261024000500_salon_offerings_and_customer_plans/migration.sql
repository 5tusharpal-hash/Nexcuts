BEGIN;

CREATE TABLE salon_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    total_value NUMERIC(12, 2) NOT NULL CHECK (total_value >= 0),
    validity_days INTEGER NOT NULL CHECK (validity_days > 0),
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id)
);

CREATE TABLE salon_package_services (
    package_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    PRIMARY KEY (package_id, service_id),
    FOREIGN KEY (package_id, salon_id)
        REFERENCES salon_packages(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_service_combos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    bundle_price NUMERIC(12, 2) NOT NULL CHECK (bundle_price >= 0),
    validity_days INTEGER NOT NULL DEFAULT 7 CHECK (validity_days > 0),
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id)
);

CREATE TABLE salon_combo_services (
    combo_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    PRIMARY KEY (combo_id, service_id),
    FOREIGN KEY (combo_id, salon_id)
        REFERENCES salon_service_combos(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE customer_package_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    package_id UUID,
    custom_name VARCHAR(255),
    custom_value NUMERIC(12, 2) CHECK (custom_value IS NULL OR custom_value >= 0),
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    remaining_value NUMERIC(12, 2) CHECK (remaining_value IS NULL OR remaining_value >= 0),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (payment_status IN ('PENDING', 'PAID', 'REFUNDED', 'FAILED')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED')),
    is_manual_assignment BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (expires_at > starts_at),
    CHECK (package_id IS NOT NULL OR custom_name IS NOT NULL),
    UNIQUE (id, salon_id),
    FOREIGN KEY (package_id, salon_id)
        REFERENCES salon_packages(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE customer_package_service_balances (
    subscription_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    PRIMARY KEY (subscription_id, service_id),
    CHECK (max_uses IS NULL OR used_count <= max_uses),
    FOREIGN KEY (subscription_id, salon_id)
        REFERENCES customer_package_subscriptions(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE customer_combo_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    combo_id UUID NOT NULL,
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (payment_status IN ('PENDING', 'PAID', 'REFUNDED', 'FAILED')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'USED', 'EXPIRED', 'CANCELLED')),
    is_manual_assignment BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (combo_id, salon_id)
        REFERENCES salon_service_combos(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_loyalty_programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL UNIQUE REFERENCES salons(id) ON DELETE CASCADE,
    minimum_spend NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (minimum_spend >= 0),
    reward_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (reward_percentage BETWEEN 0 AND 100),
    point_conversion_rate NUMERIC(8, 4) NOT NULL DEFAULT 1 CHECK (point_conversion_rate > 0),
    points_expiry_days INTEGER CHECK (points_expiry_days IS NULL OR points_expiry_days > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id)
);

CREATE TABLE salon_loyalty_eligible_services (
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    PRIMARY KEY (salon_id, service_id),
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE CASCADE
);

CREATE TABLE customer_loyalty_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount <> 0),
    transaction_reference UUID,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX customer_package_subscriptions_expiry_idx
    ON customer_package_subscriptions (customer_account_id, salon_id, expires_at);
CREATE INDEX customer_combo_purchases_expiry_idx
    ON customer_combo_purchases (customer_account_id, salon_id, expires_at);
CREATE INDEX customer_loyalty_ledger_expiry_idx
    ON customer_loyalty_ledger (customer_account_id, salon_id, expires_at);

COMMIT;
