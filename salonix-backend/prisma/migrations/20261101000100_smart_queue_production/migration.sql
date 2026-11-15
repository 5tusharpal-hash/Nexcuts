BEGIN;

ALTER TABLE queue_entries
    ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS schedule_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS manual_override_reason TEXT,
    ADD COLUMN IF NOT EXISTS last_recalculated_at TIMESTAMPTZ;

ALTER TABLE queue_conflict_alerts
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    ADD COLUMN IF NOT EXISTS resolution VARCHAR(20),
    ADD COLUMN IF NOT EXISTS resolved_by_account_id UUID,
    ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'queue_conflict_alerts_status_check'
    ) THEN
        ALTER TABLE queue_conflict_alerts
            ADD CONSTRAINT queue_conflict_alerts_status_check
            CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS queue_schedule_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    entry_id UUID REFERENCES queue_entries(id) ON DELETE SET NULL,
    actor_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    event_type VARCHAR(40) NOT NULL,
    reason TEXT,
    before_schedule JSONB,
    after_schedule JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS queue_schedule_events_salon_created_idx
    ON queue_schedule_events (salon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS queue_conflict_alerts_open_idx
    ON queue_conflict_alerts (entry_id, status) WHERE status = 'OPEN';

COMMIT;
