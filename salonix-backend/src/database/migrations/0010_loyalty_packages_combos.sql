-- Migration: 0010_loyalty_packages_combos.sql
-- Description: Implements Packages, Combos, and the FIFO Loyalty Ledger.

-- 1. Packages (Time-limited Contracts)
CREATE TABLE IF NOT EXISTS packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    total_value DECIMAL(12, 2) NOT NULL, -- The usable value (e.g., 3200)
    validity_days INT NOT NULL, -- e.g., 90 for 3 months
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS package_service_limits (
    package_id UUID REFERENCES packages(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id),
    max_uses INT, -- NULL means unlimited
    PRIMARY KEY (package_id, service_id)
);

CREATE TABLE IF NOT EXISTS user_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    package_id UUID REFERENCES packages(id), -- Nullable for purely custom plans
    custom_name VARCHAR(255),
    custom_value DECIMAL(12, 2),
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
    remaining_value DECIMAL(12, 2),
    payment_status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, PAID
    is_manual_assignment BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Combos (Bundle Discounts)
CREATE TABLE IF NOT EXISTS service_combos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    bundle_price DECIMAL(12, 2) NOT NULL,
    validity_days INT DEFAULT 7,
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS combo_services (
    combo_id UUID REFERENCES service_combos(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id),
    PRIMARY KEY (combo_id, service_id)
);

CREATE TABLE IF NOT EXISTS user_combos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    combo_id UUID REFERENCES service_combos(id),
    activated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    is_manual_assignment BOOLEAN DEFAULT FALSE,
    payment_status VARCHAR(20) DEFAULT 'PENDING'
);

-- 3. Loyalty Program
CREATE TABLE IF NOT EXISTS loyalty_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    min_spend_threshold DECIMAL(12, 2) DEFAULT 0,
    reward_percentage DECIMAL(5, 2) DEFAULT 0,
    point_conversion_rate DECIMAL(5, 2) DEFAULT 1.0, -- e.g., 1.0 means 1pt = 1rupee
    points_expiry_days INT DEFAULT 365,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Logic: Mapping which services earn points
CREATE TABLE IF NOT EXISTS loyalty_eligible_services (
    service_id UUID PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE
);

-- FIFO Loyalty Ledger (Each point batch has its own expiry)
CREATE TABLE IF NOT EXISTS loyalty_points_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    amount DECIMAL(12, 2) NOT NULL, -- Positive for earn, negative for redeem
    transaction_id UUID, -- Link to the bill/invoice
    expiry_date TIMESTAMP WITH TIME ZONE, -- Only for earns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_loyalty_user_expiry ON loyalty_points_ledger(user_id, expiry_date);
CREATE INDEX idx_user_packages_expiry ON user_packages(expiry_date);
CREATE INDEX idx_user_combos_expiry ON user_combos(expiry_date);
