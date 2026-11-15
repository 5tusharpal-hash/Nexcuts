BEGIN;

ALTER TABLE queue_entries
    ADD COLUMN IF NOT EXISTS owner_approved_after_hours BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS owner_approval_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS queue_closing_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
    requested_start_at TIMESTAMPTZ NOT NULL,
    requested_end_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    requested_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    review_note TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT queue_closing_requests_unique_entry UNIQUE (entry_id),
    CONSTRAINT queue_closing_requests_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'))
);

CREATE INDEX IF NOT EXISTS queue_closing_requests_salon_status_created_idx
    ON queue_closing_requests (salon_id, status, created_at);
CREATE INDEX IF NOT EXISTS queue_closing_requests_pending_expiry_idx
    ON queue_closing_requests (expires_at)
    WHERE status = 'PENDING';

COMMIT;
