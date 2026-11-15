BEGIN;

CREATE TABLE salon_employee_tip_refund_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    tip_request_id UUID NOT NULL,
    customer_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    source VARCHAR(12) NOT NULL CHECK (source IN ('CUSTOMER', 'DESK')),
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PAYOUT_PENDING', 'REJECTED', 'COMPLETED')),
    requested_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    completed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    completed_at TIMESTAMPTZ,
    payout_reference VARCHAR(255),
    completion_note TEXT,
    idempotency_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    UNIQUE (salon_id, idempotency_key),
    FOREIGN KEY (tip_request_id, salon_id)
        REFERENCES salon_employee_tip_requests(id, salon_id) ON DELETE RESTRICT,
    CHECK (
        (
            status = 'PENDING' AND reviewed_at IS NULL
            AND reviewed_by_account_id IS NULL AND completed_at IS NULL
            AND completed_by_account_id IS NULL
        )
        OR (
            status = 'REJECTED' AND reviewed_at IS NOT NULL
            AND reviewed_by_account_id IS NOT NULL AND completed_at IS NULL
            AND completed_by_account_id IS NULL
        )
        OR (
            status = 'PAYOUT_PENDING' AND reviewed_at IS NOT NULL
            AND reviewed_by_account_id IS NOT NULL AND completed_at IS NULL
            AND completed_by_account_id IS NULL
        )
        OR (
            status = 'COMPLETED' AND reviewed_at IS NOT NULL
            AND reviewed_by_account_id IS NOT NULL AND completed_at IS NOT NULL
            AND completed_by_account_id IS NOT NULL AND completion_note IS NOT NULL
        )
    )
);

CREATE INDEX salon_employee_tip_refund_review_idx
    ON salon_employee_tip_refund_requests (salon_id, status, created_at DESC);
CREATE INDEX salon_employee_tip_refund_customer_idx
    ON salon_employee_tip_refund_requests (salon_id, customer_account_id, created_at DESC);
CREATE INDEX salon_employee_tip_refund_tip_idx
    ON salon_employee_tip_refund_requests (salon_id, tip_request_id, status);

ALTER TABLE salon_employee_tip_ledger
    DROP CONSTRAINT salon_employee_tip_ledger_request_id_entry_type_key,
    ADD COLUMN refund_request_id UUID,
    ADD CONSTRAINT salon_employee_tip_ledger_refund_request_fk
        FOREIGN KEY (refund_request_id, salon_id)
        REFERENCES salon_employee_tip_refund_requests(id, salon_id) ON DELETE RESTRICT,
    ADD CONSTRAINT salon_employee_tip_ledger_refund_entry_check
        CHECK (
            (entry_type = 'TIP_CREDIT' AND refund_request_id IS NULL)
            OR (entry_type = 'REVERSAL' AND refund_request_id IS NOT NULL)
        );

CREATE UNIQUE INDEX salon_employee_tip_ledger_credit_idx
    ON salon_employee_tip_ledger (request_id)
    WHERE entry_type = 'TIP_CREDIT';
CREATE UNIQUE INDEX salon_employee_tip_ledger_refund_idx
    ON salon_employee_tip_ledger (refund_request_id)
    WHERE refund_request_id IS NOT NULL;

COMMIT;
