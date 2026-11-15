BEGIN;

CREATE TABLE salon_service_default_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_key VARCHAR(80) NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    alt_text TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX salon_service_default_images_category_active_idx
    ON salon_service_default_images (category_key, is_active);

ALTER TABLE salon_service_categories
    ADD COLUMN default_image_category_key VARCHAR(80),
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX salon_service_categories_name_per_salon_key
    ON salon_service_categories (salon_id, lower(name));

CREATE UNIQUE INDEX salon_services_name_audience_per_salon_key
    ON salon_services (salon_id, lower(name), target_audience)
    WHERE deleted_at IS NULL;

ALTER TABLE salon_services
    ADD COLUMN image_object_key TEXT,
    ADD COLUMN default_image_id UUID REFERENCES salon_service_default_images(id) ON DELETE SET NULL;

ALTER TABLE salon_gallery_images
    ADD COLUMN object_key TEXT,
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE salon_gallery_categories
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX salon_gallery_categories_name_per_salon_key
    ON salon_gallery_categories (salon_id, lower(category_name));

CREATE TABLE platform_service_image_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    service_image_required BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_service_image_settings (id, service_image_required)
VALUES (TRUE, FALSE);

INSERT INTO salon_permissions (key, description) VALUES
    ('gallery:manage', 'Manage the salon public photo gallery')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE platform_salon_entitlement_overrides (
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    feature_key VARCHAR(100) NOT NULL,
    feature_value JSONB NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    granted_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (salon_id, feature_key),
    CHECK (feature_key = 'public_gallery_limit'),
    CHECK (jsonb_typeof(feature_value) = 'number'),
    CHECK ((feature_value #>> '{}') ~ '^[0-9]+$')
);

COMMIT;
