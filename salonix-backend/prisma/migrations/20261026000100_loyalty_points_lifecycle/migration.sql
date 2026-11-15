BEGIN;

ALTER TABLE salon_loyalty_programs
    ALTER COLUMN points_expiry_days SET DEFAULT 365;

UPDATE salon_loyalty_programs
SET points_expiry_days = 365
WHERE points_expiry_days IS NULL;

ALTER TABLE salon_loyalty_programs
    ALTER COLUMN points_expiry_days SET NOT NULL,
    ADD COLUMN closed_at TIMESTAMPTZ,
    ADD COLUMN redeem_until TIMESTAMPTZ,
    ADD COLUMN expiry_locked_at TIMESTAMPTZ,
    ADD CONSTRAINT salon_loyalty_programs_expiry_days_check
        CHECK (points_expiry_days BETWEEN 1 AND 3650);

CREATE TABLE salon_loyalty_eligible_categories (
    salon_id UUID NOT NULL REFERENCES salon_loyalty_programs(salon_id) ON DELETE RESTRICT,
    category VARCHAR(20) NOT NULL
        CHECK (category IN ('SERVICE', 'PRODUCT', 'PACKAGE', 'COMBO')),
    is_eligible BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (salon_id, category)
);

INSERT INTO salon_loyalty_eligible_categories (salon_id, category)
SELECT DISTINCT eligible.salon_id, 'SERVICE'
FROM salon_loyalty_eligible_services AS eligible
JOIN salon_loyalty_programs AS program ON program.salon_id = eligible.salon_id
ON CONFLICT (salon_id, category) DO NOTHING;

ALTER TABLE customer_loyalty_ledger
    ADD COLUMN entry_type VARCHAR(20),
    ADD COLUMN idempotency_key VARCHAR(255),
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE customer_loyalty_ledger
SET entry_type = CASE WHEN amount > 0 THEN 'EARNED' ELSE 'REDEEMED' END,
    expires_at = CASE
        WHEN amount > 0 AND expires_at IS NULL
        THEN created_at + INTERVAL '365 days'
        ELSE expires_at
    END;

ALTER TABLE customer_loyalty_ledger
    ALTER COLUMN entry_type SET NOT NULL,
    ALTER COLUMN entry_type SET DEFAULT 'EARNED',
    ADD CONSTRAINT customer_loyalty_ledger_entry_type_check
        CHECK (entry_type IN ('EARNED', 'REDEEMED', 'EXPIRED', 'REVERSAL'));

CREATE UNIQUE INDEX customer_loyalty_ledger_idempotency_idx
    ON customer_loyalty_ledger (salon_id, idempotency_key);

CREATE TABLE customer_loyalty_lot_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_entry_id UUID NOT NULL
        REFERENCES customer_loyalty_ledger(id) ON DELETE RESTRICT,
    earning_entry_id UUID NOT NULL
        REFERENCES customer_loyalty_ledger(id) ON DELETE RESTRICT,
    points_amount NUMERIC(12, 2) NOT NULL CHECK (points_amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ledger_entry_id, earning_entry_id)
);

CREATE INDEX customer_loyalty_lot_allocations_earning_idx
    ON customer_loyalty_lot_allocations (earning_entry_id, created_at);

DO $$
DECLARE
    debit RECORD;
    earning RECORD;
    remaining_points NUMERIC(12, 2);
    allocated_points NUMERIC(12, 2);
BEGIN
    FOR debit IN
        SELECT id, customer_account_id, salon_id, -amount AS points, created_at
        FROM customer_loyalty_ledger
        WHERE amount < 0 AND entry_type = 'REDEEMED'
        ORDER BY created_at, id
    LOOP
        remaining_points := debit.points;
        FOR earning IN
            SELECT earned.id,
                   earned.amount - COALESCE(SUM(allocation.points_amount), 0) AS remaining
            FROM customer_loyalty_ledger AS earned
            LEFT JOIN customer_loyalty_lot_allocations AS allocation
              ON allocation.earning_entry_id = earned.id
            WHERE earned.customer_account_id = debit.customer_account_id
              AND earned.salon_id = debit.salon_id
              AND earned.amount > 0
              AND earned.entry_type = 'EARNED'
              AND earned.created_at <= debit.created_at
              AND (earned.expires_at IS NULL OR earned.expires_at > debit.created_at)
            GROUP BY earned.id, earned.amount, earned.expires_at, earned.created_at
            HAVING earned.amount - COALESCE(SUM(allocation.points_amount), 0) > 0
            ORDER BY earned.expires_at ASC NULLS LAST, earned.created_at, earned.id
        LOOP
            EXIT WHEN remaining_points <= 0;
            allocated_points := LEAST(remaining_points, earning.remaining);
            INSERT INTO customer_loyalty_lot_allocations (
                ledger_entry_id, earning_entry_id, points_amount
            ) VALUES (debit.id, earning.id, allocated_points);
            remaining_points := remaining_points - allocated_points;
        END LOOP;
    END LOOP;
END;
$$;

UPDATE salon_loyalty_programs AS program
SET expiry_locked_at = COALESCE(
    program.expiry_locked_at,
    (
        SELECT MIN(ledger.created_at)
        FROM customer_loyalty_ledger AS ledger
        WHERE ledger.salon_id = program.salon_id
          AND ledger.entry_type = 'EARNED'
    )
)
WHERE EXISTS (
    SELECT 1
    FROM customer_loyalty_ledger AS ledger
    WHERE ledger.salon_id = program.salon_id
      AND ledger.entry_type = 'EARNED'
);

CREATE TABLE salon_loyalty_program_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salon_loyalty_programs(salon_id) ON DELETE RESTRICT,
    event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('CREATED', 'UPDATED', 'CLOSED')),
    before_state JSONB,
    after_state JSONB NOT NULL,
    actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX salon_loyalty_program_events_history_idx
    ON salon_loyalty_program_events (salon_id, created_at);

COMMIT;
