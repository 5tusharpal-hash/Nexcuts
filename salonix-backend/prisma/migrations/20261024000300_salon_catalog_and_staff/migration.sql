BEGIN;

CREATE TABLE salon_service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    parent_id UUID,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    FOREIGN KEY (parent_id, salon_id)
        REFERENCES salon_service_categories(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    category_id UUID,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    estimated_duration_minutes INTEGER NOT NULL CHECK (estimated_duration_minutes > 0),
    base_price NUMERIC(12, 2) NOT NULL CHECK (base_price >= 0),
    target_audience VARCHAR(20) NOT NULL DEFAULT 'UNISEX'
        CHECK (target_audience IN ('MEN', 'WOMEN', 'KIDS', 'UNISEX')),
    image_url TEXT,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    reminder_days INTEGER CHECK (reminder_days IS NULL OR reminder_days > 0),
    automation_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    UNIQUE (id, salon_id),
    FOREIGN KEY (category_id, salon_id)
        REFERENCES salon_service_categories(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_staff_profiles (
    membership_id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    account_id UUID NOT NULL,
    bio TEXT,
    profile_image_url TEXT,
    experience_years INTEGER CHECK (experience_years IS NULL OR experience_years >= 0),
    serve_type VARCHAR(20) NOT NULL DEFAULT 'UNISEX'
        CHECK (serve_type IN ('MEN', 'WOMEN', 'UNISEX')),
    commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0
        CHECK (commission_rate BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (membership_id, organization_id, account_id)
        REFERENCES salon_memberships(id, organization_id, account_id) ON DELETE CASCADE
);

CREATE TABLE salon_staff_skills (
    membership_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    proficiency_level VARCHAR(20) NOT NULL DEFAULT 'STANDARD'
        CHECK (proficiency_level IN ('STANDARD', 'EXPERT', 'MASTER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (membership_id, service_id),
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE CASCADE
);

CREATE TABLE salon_staff_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    starts_at TIME NOT NULL,
    ends_at TIME NOT NULL,
    effective_from DATE,
    effective_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (ends_at > starts_at),
    CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from),
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE CASCADE
);

CREATE INDEX salon_services_salon_active_idx ON salon_services (salon_id, is_active);
CREATE INDEX salon_staff_skills_service_idx ON salon_staff_skills (salon_id, service_id);
CREATE INDEX salon_staff_availability_lookup_idx
    ON salon_staff_availability (salon_id, membership_id, day_of_week);

COMMIT;
