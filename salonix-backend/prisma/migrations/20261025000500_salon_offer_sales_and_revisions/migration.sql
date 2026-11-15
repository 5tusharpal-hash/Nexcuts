BEGIN;

ALTER TABLE salon_packages
    ADD COLUMN selling_price NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (selling_price >= 0),
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'UNLISTED', 'LISTED', 'ARCHIVED')),
    ADD COLUMN current_revision_id UUID;

ALTER TABLE salon_service_combos
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'UNLISTED', 'LISTED', 'ARCHIVED')),
    ADD COLUMN current_revision_id UUID;

UPDATE salon_packages
SET status = CASE
    WHEN is_active = FALSE THEN 'ARCHIVED'
    ELSE 'UNLISTED'
END;

UPDATE salon_service_combos
SET status = CASE
    WHEN is_active = FALSE THEN 'ARCHIVED'
    WHEN is_public = TRUE THEN 'LISTED'
    ELSE 'UNLISTED'
END;

CREATE TABLE salon_package_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    selling_price NUMERIC(12, 2) NOT NULL CHECK (selling_price >= 0),
    credit_amount NUMERIC(12, 2) NOT NULL CHECK (credit_amount >= 0),
    validity_days INTEGER NOT NULL CHECK (validity_days > 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT', 'UNLISTED', 'LISTED', 'ARCHIVED')),
    created_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    UNIQUE (package_id, revision_number),
    FOREIGN KEY (package_id, salon_id)
        REFERENCES salon_packages(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_package_revision_services (
    revision_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    service_price_at_revision NUMERIC(12, 2) NOT NULL CHECK (service_price_at_revision >= 0),
    estimated_duration_minutes INTEGER NOT NULL CHECK (estimated_duration_minutes > 0),
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    PRIMARY KEY (revision_id, service_id),
    FOREIGN KEY (revision_id, salon_id)
        REFERENCES salon_package_revisions(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_combo_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    combo_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    selling_price NUMERIC(12, 2) NOT NULL CHECK (selling_price >= 0),
    validity_days INTEGER NOT NULL CHECK (validity_days > 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT', 'UNLISTED', 'LISTED', 'ARCHIVED')),
    created_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    UNIQUE (combo_id, revision_number),
    FOREIGN KEY (combo_id, salon_id)
        REFERENCES salon_service_combos(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_combo_revision_services (
    revision_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    service_price_at_revision NUMERIC(12, 2) NOT NULL CHECK (service_price_at_revision >= 0),
    estimated_duration_minutes INTEGER NOT NULL CHECK (estimated_duration_minutes > 0),
    PRIMARY KEY (revision_id, service_id),
    FOREIGN KEY (revision_id, salon_id)
        REFERENCES salon_combo_revisions(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT
);

INSERT INTO salon_package_revisions (
    package_id, salon_id, revision_number, name, description, selling_price,
    credit_amount, validity_days, status
)
SELECT id, salon_id, 1, name, description, selling_price, total_value, validity_days, status
FROM salon_packages;

INSERT INTO salon_package_revision_services (
    revision_id, salon_id, service_id, service_name, service_price_at_revision,
    estimated_duration_minutes, max_uses
)
SELECT revision.id, package_service.salon_id, service.id, service.name,
       service.base_price, service.estimated_duration_minutes, package_service.max_uses
FROM salon_package_revisions AS revision
JOIN salon_package_services AS package_service
  ON package_service.package_id = revision.package_id
 AND package_service.salon_id = revision.salon_id
JOIN salon_services AS service
  ON service.id = package_service.service_id
 AND service.salon_id = package_service.salon_id;

UPDATE salon_packages AS package
SET current_revision_id = revision.id
FROM salon_package_revisions AS revision
WHERE revision.package_id = package.id
  AND revision.salon_id = package.salon_id;

ALTER TABLE salon_packages
    ADD CONSTRAINT salon_packages_current_revision_fk
        FOREIGN KEY (current_revision_id, salon_id)
        REFERENCES salon_package_revisions(id, salon_id) ON DELETE RESTRICT;

INSERT INTO salon_combo_revisions (
    combo_id, salon_id, revision_number, name, description, selling_price,
    validity_days, status
)
SELECT id, salon_id, 1, name, description, bundle_price, validity_days, status
FROM salon_service_combos;

INSERT INTO salon_combo_revision_services (
    revision_id, salon_id, service_id, service_name, service_price_at_revision,
    estimated_duration_minutes
)
SELECT revision.id, combo_service.salon_id, service.id, service.name,
       service.base_price, service.estimated_duration_minutes
FROM salon_combo_revisions AS revision
JOIN salon_combo_services AS combo_service
  ON combo_service.combo_id = revision.combo_id
 AND combo_service.salon_id = revision.salon_id
JOIN salon_services AS service
  ON service.id = combo_service.service_id
 AND service.salon_id = combo_service.salon_id;

UPDATE salon_service_combos AS combo
SET current_revision_id = revision.id
FROM salon_combo_revisions AS revision
WHERE revision.combo_id = combo.id
  AND revision.salon_id = combo.salon_id;

ALTER TABLE salon_service_combos
    ADD CONSTRAINT salon_service_combos_current_revision_fk
        FOREIGN KEY (current_revision_id, salon_id)
        REFERENCES salon_combo_revisions(id, salon_id) ON DELETE RESTRICT;

CREATE TABLE salon_offer_purchase_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    offer_type VARCHAR(20) NOT NULL CHECK (offer_type IN ('PACKAGE', 'COMBO')),
    package_id UUID,
    combo_id UUID,
    package_revision_id UUID,
    combo_revision_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'BILLING', 'ACCEPTED', 'REJECTED', 'CANCELLED')),
    payment_mode VARCHAR(20)
        CHECK (payment_mode IS NULL OR payment_mode IN ('CASH', 'UPI', 'CARD', 'OTHER')),
    list_price NUMERIC(12, 2) NOT NULL CHECK (list_price >= 0),
    final_amount NUMERIC(12, 2) NOT NULL CHECK (final_amount >= 0),
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    discount_reason TEXT,
    terms_snapshot JSONB NOT NULL,
    services_snapshot JSONB NOT NULL,
    is_manual_assignment BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    bill_id UUID,
    idempotency_key VARCHAR(255),
    rejected_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    rejection_reason TEXT,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    UNIQUE (created_by_account_id, idempotency_key),
    CHECK (
        (offer_type = 'PACKAGE'
            AND package_id IS NOT NULL
            AND package_revision_id IS NOT NULL
            AND combo_id IS NULL
            AND combo_revision_id IS NULL)
        OR
        (offer_type = 'COMBO'
            AND combo_id IS NOT NULL
            AND combo_revision_id IS NOT NULL
            AND package_id IS NULL
            AND package_revision_id IS NULL)
    ),
    CHECK (final_amount <= list_price),
    CHECK (discount_amount = list_price - final_amount),
    CHECK (discount_amount = 0 OR NULLIF(BTRIM(discount_reason), '') IS NOT NULL),
    CHECK (
        (status = 'REJECTED' AND NULLIF(BTRIM(rejection_reason), '') IS NOT NULL)
        OR (status <> 'REJECTED' AND rejection_reason IS NULL)
    ),
    FOREIGN KEY (package_id, salon_id)
        REFERENCES salon_packages(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (combo_id, salon_id)
        REFERENCES salon_service_combos(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (package_revision_id, salon_id)
        REFERENCES salon_package_revisions(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (combo_revision_id, salon_id)
        REFERENCES salon_combo_revisions(id, salon_id) ON DELETE RESTRICT
);

ALTER TABLE salon_offer_purchase_requests
    ADD CONSTRAINT salon_offer_purchase_requests_bill_fk
        FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT;

ALTER TABLE pos_bills
    ADD COLUMN offer_purchase_request_id UUID,
    ADD CONSTRAINT pos_bills_offer_purchase_request_fk
        FOREIGN KEY (offer_purchase_request_id, salon_id)
        REFERENCES salon_offer_purchase_requests(id, salon_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX salon_offer_purchase_requests_bill_idx
    ON salon_offer_purchase_requests (salon_id, bill_id)
    WHERE bill_id IS NOT NULL;
CREATE UNIQUE INDEX pos_bills_offer_purchase_request_idx
    ON pos_bills (salon_id, offer_purchase_request_id)
    WHERE offer_purchase_request_id IS NOT NULL;
CREATE INDEX salon_offer_purchase_requests_salon_status_idx
    ON salon_offer_purchase_requests (salon_id, status, created_at DESC);
CREATE INDEX salon_offer_purchase_requests_customer_idx
    ON salon_offer_purchase_requests (customer_account_id, created_at DESC);

ALTER TABLE customer_package_subscriptions
    ADD COLUMN purchase_request_id UUID,
    ADD COLUMN selling_price NUMERIC(12, 2) CHECK (selling_price IS NULL OR selling_price >= 0),
    ADD COLUMN terms_snapshot JSONB;

ALTER TABLE customer_combo_purchases
    ADD COLUMN purchase_request_id UUID,
    ADD COLUMN selling_price NUMERIC(12, 2) CHECK (selling_price IS NULL OR selling_price >= 0),
    ADD COLUMN terms_snapshot JSONB;

ALTER TABLE customer_package_subscriptions
    ADD CONSTRAINT customer_package_subscriptions_purchase_request_fk
        FOREIGN KEY (purchase_request_id, salon_id)
        REFERENCES salon_offer_purchase_requests(id, salon_id) ON DELETE RESTRICT,
    ADD CONSTRAINT customer_package_subscriptions_purchase_request_unique
        UNIQUE (purchase_request_id);

ALTER TABLE customer_combo_purchases
    ADD CONSTRAINT customer_combo_purchases_purchase_request_fk
        FOREIGN KEY (purchase_request_id, salon_id)
        REFERENCES salon_offer_purchase_requests(id, salon_id) ON DELETE RESTRICT,
    ADD CONSTRAINT customer_combo_purchases_purchase_request_unique
        UNIQUE (purchase_request_id);

CREATE TABLE salon_offer_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    purchase_request_id UUID NOT NULL,
    entry_type VARCHAR(20) NOT NULL
        CHECK (entry_type IN ('SALE', 'PACKAGE_REDEMPTION', 'COMBO_REDEMPTION', 'REVERSAL')),
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    service_id UUID,
    bill_id UUID,
    idempotency_key VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_request_id, salon_id)
        REFERENCES salon_offer_purchase_requests(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT,
    UNIQUE (salon_id, idempotency_key)
);

CREATE INDEX salon_offer_ledger_customer_idx
    ON salon_offer_ledger (customer_account_id, salon_id, created_at DESC);
CREATE INDEX salon_offer_ledger_purchase_idx
    ON salon_offer_ledger (purchase_request_id, created_at DESC);

COMMIT;
