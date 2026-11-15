BEGIN;

CREATE TYPE account_type AS ENUM ('CUSTOMER', 'SALON', 'PLATFORM', 'ADMIN');

ALTER TABLE accounts
    ADD COLUMN account_type account_type NOT NULL DEFAULT 'CUSTOMER';

ALTER TABLE accounts
    DROP CONSTRAINT accounts_email_key,
    DROP CONSTRAINT accounts_phone_number_key;

CREATE UNIQUE INDEX accounts_account_type_email_key
    ON accounts (account_type, email);
CREATE UNIQUE INDEX accounts_account_type_phone_number_key
    ON accounts (account_type, phone_number);

CREATE TABLE salon_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL UNIQUE,
    applicant_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    business_type VARCHAR(20) NOT NULL CHECK (business_type IN ('SOLO', 'TEAM')),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED')),
    proposed_services JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(proposed_services) = 'array'),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salon_id, organization_id)
        REFERENCES salons(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE salon_business_hours (
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    is_closed BOOLEAN NOT NULL DEFAULT FALSE,
    opens_at TIME,
    closes_at TIME,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (salon_id, day_of_week),
    CHECK (
        (is_closed AND opens_at IS NULL AND closes_at IS NULL)
        OR
        (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)
    )
);

CREATE INDEX salon_applications_status_submitted_idx
    ON salon_applications (status, submitted_at);

COMMIT;
