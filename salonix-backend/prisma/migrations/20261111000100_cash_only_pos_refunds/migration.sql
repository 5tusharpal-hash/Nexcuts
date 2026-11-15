BEGIN;

ALTER TABLE pos_refunds
    ADD COLUMN settlement_method VARCHAR(20),
    ADD COLUMN cash_payout_reference VARCHAR(255),
    ADD COLUMN cash_paid_at TIMESTAMPTZ;

UPDATE pos_refunds
SET settlement_method = 'LEGACY_CREDIT'
WHERE status = 'COMPLETED';

ALTER TABLE pos_refunds
    ADD CONSTRAINT pos_refunds_settlement_method_check
        CHECK (settlement_method IS NULL OR settlement_method IN ('CASH', 'LEGACY_CREDIT')),
    ADD CONSTRAINT pos_refunds_completed_settlement_check
        CHECK (status <> 'COMPLETED' OR settlement_method IS NOT NULL),
    ADD CONSTRAINT pos_refunds_cash_settlement_check
        CHECK (
            settlement_method <> 'CASH'
            OR (status = 'COMPLETED' AND cash_paid_at IS NOT NULL)
        );

CREATE UNIQUE INDEX pos_refunds_salon_idempotency_key_idx
    ON pos_refunds (salon_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX pos_credit_notes_salon_idempotency_key_idx
    ON pos_credit_notes (salon_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMIT;
