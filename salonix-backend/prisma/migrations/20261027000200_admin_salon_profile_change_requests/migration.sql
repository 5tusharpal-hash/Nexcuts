BEGIN;

CREATE TABLE salon_profile_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    requested_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    proposed_changes JSONB NOT NULL
        CHECK (jsonb_typeof(proposed_changes) = 'object' AND proposed_changes <> '{}'::jsonb),
    request_notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (status = 'PENDING' AND reviewed_by_account_id IS NULL AND reviewed_at IS NULL)
        OR
        (status IN ('APPROVED', 'REJECTED')
         AND reviewed_by_account_id IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
    FOREIGN KEY (salon_id, organization_id)
        REFERENCES salons(id, organization_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX salon_profile_change_requests_one_pending_per_salon_idx
    ON salon_profile_change_requests (salon_id)
    WHERE status = 'PENDING';

CREATE INDEX salon_profile_change_requests_status_created_idx
    ON salon_profile_change_requests (status, created_at DESC);

CREATE INDEX salon_profile_change_requests_salon_created_idx
    ON salon_profile_change_requests (salon_id, created_at DESC);

COMMIT;
