BEGIN;

CREATE TABLE salon_employee_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    membership_id UUID NOT NULL,
    clocked_in_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clocked_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (clocked_out_at IS NULL OR clocked_out_at > clocked_in_at),
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX salon_employee_one_open_shift_idx
    ON salon_employee_shifts (salon_id, membership_id)
    WHERE clocked_out_at IS NULL;
CREATE INDEX salon_employee_shifts_history_idx
    ON salon_employee_shifts (salon_id, membership_id, clocked_in_at DESC);

CREATE TABLE salon_employee_lunch_breaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES salon_employee_shifts(id) ON DELETE RESTRICT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE UNIQUE INDEX salon_employee_one_open_lunch_idx
    ON salon_employee_lunch_breaks (shift_id)
    WHERE ended_at IS NULL;
CREATE INDEX salon_employee_lunch_shift_idx
    ON salon_employee_lunch_breaks (shift_id, started_at);

CREATE TABLE salon_employee_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    holiday_date DATE NOT NULL,
    name VARCHAR(160) NOT NULL,
    is_paid BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT,
    created_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (salon_id, holiday_date)
);

CREATE TABLE salon_employee_leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    is_paid BOOLEAN NOT NULL DEFAULT TRUE,
    deducts_balance BOOLEAN NOT NULL DEFAULT TRUE,
    is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (salon_id, name),
    UNIQUE (id, salon_id)
);

CREATE TABLE salon_employee_leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    leave_type_id UUID NOT NULL,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    requested_days NUMERIC(6, 2) NOT NULL CHECK (requested_days > 0),
    reason TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    reviewed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (ends_on >= starts_on),
    UNIQUE (id, salon_id),
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (leave_type_id, salon_id)
        REFERENCES salon_employee_leave_types(id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX salon_employee_leave_requests_member_idx
    ON salon_employee_leave_requests (salon_id, membership_id, starts_on DESC);
CREATE INDEX salon_employee_leave_requests_review_idx
    ON salon_employee_leave_requests (salon_id, status, created_at);

CREATE TABLE salon_employee_leave_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    leave_type_id UUID NOT NULL,
    request_id UUID,
    entry_type VARCHAR(16) NOT NULL CHECK (entry_type IN ('GRANT', 'DEBIT', 'REVERSAL', 'ADJUSTMENT')),
    days_change NUMERIC(8, 2) NOT NULL CHECK (days_change <> 0),
    note TEXT NOT NULL,
    actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (leave_type_id, salon_id)
        REFERENCES salon_employee_leave_types(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (request_id, salon_id)
        REFERENCES salon_employee_leave_requests(id, salon_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX salon_employee_leave_request_debit_idx
    ON salon_employee_leave_ledger (request_id)
    WHERE request_id IS NOT NULL AND entry_type = 'DEBIT';
CREATE INDEX salon_employee_leave_ledger_balance_idx
    ON salon_employee_leave_ledger (salon_id, membership_id, leave_type_id, created_at);

ALTER TABLE queue_entry_staff
    ADD CONSTRAINT queue_entry_staff_id_salon_key UNIQUE (id, salon_id);

CREATE TABLE salon_employee_service_work (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    service_id UUID NOT NULL,
    queue_entry_staff_id UUID,
    bill_item_id UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    started_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    ended_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((queue_entry_staff_id IS NULL) <> (bill_item_id IS NULL)),
    CHECK (ended_at IS NULL OR ended_at > started_at),
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (queue_entry_staff_id, salon_id)
        REFERENCES queue_entry_staff(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (bill_item_id, salon_id)
        REFERENCES pos_bill_items(id, salon_id) ON DELETE RESTRICT,
    UNIQUE (id, salon_id)
);

CREATE UNIQUE INDEX salon_employee_service_work_queue_idx
    ON salon_employee_service_work (queue_entry_staff_id)
    WHERE queue_entry_staff_id IS NOT NULL;
CREATE UNIQUE INDEX salon_employee_service_work_bill_item_idx
    ON salon_employee_service_work (bill_item_id, membership_id)
    WHERE bill_item_id IS NOT NULL;
CREATE INDEX salon_employee_service_work_history_idx
    ON salon_employee_service_work (salon_id, membership_id, started_at DESC);

CREATE TABLE salon_employee_tip_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    session_id UUID NOT NULL,
    bill_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    customer_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    source VARCHAR(12) NOT NULL CHECK (source IN ('CUSTOMER', 'DESK')),
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    requested_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    idempotency_key VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    FOREIGN KEY (session_id, salon_id)
        REFERENCES pos_billing_sessions(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT,
    UNIQUE (salon_id, idempotency_key)
);

CREATE INDEX salon_employee_tip_requests_review_idx
    ON salon_employee_tip_requests (salon_id, status, created_at DESC);
CREATE INDEX salon_employee_tip_requests_staff_idx
    ON salon_employee_tip_requests (salon_id, membership_id, created_at DESC);
CREATE UNIQUE INDEX salon_employee_one_tip_per_bill_staff_idx
    ON salon_employee_tip_requests (bill_id, membership_id)
    WHERE status IN ('PENDING', 'APPROVED');

CREATE TABLE salon_employee_tip_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    request_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    amount_change NUMERIC(12, 2) NOT NULL CHECK (amount_change <> 0),
    entry_type VARCHAR(12) NOT NULL CHECK (entry_type IN ('TIP_CREDIT', 'REVERSAL')),
    actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id, salon_id)
        REFERENCES salon_employee_tip_requests(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT,
    UNIQUE (request_id, entry_type)
);

CREATE INDEX salon_employee_tip_ledger_staff_idx
    ON salon_employee_tip_ledger (salon_id, membership_id, created_at DESC);

ALTER TABLE pos_tips
    ADD COLUMN request_id UUID UNIQUE
        REFERENCES salon_employee_tip_requests(id) ON DELETE RESTRICT;

COMMIT;
