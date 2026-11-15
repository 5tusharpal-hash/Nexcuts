BEGIN;

CREATE TABLE booking_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    coordinator_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    group_name VARCHAR(120),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id)
);

CREATE TABLE customer_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    group_id UUID,
    appointment_date DATE NOT NULL,
    appointment_at TIMESTAMPTZ NOT NULL,
    estimated_duration_minutes INTEGER NOT NULL CHECK (estimated_duration_minutes > 0),
    booking_type VARCHAR(20) NOT NULL DEFAULT 'APPOINTMENT'
        CHECK (booking_type IN ('APPOINTMENT', 'WALK_IN', 'GROUP')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
    notes TEXT,
    is_coordinator BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    UNIQUE (id, salon_id, customer_account_id),
    FOREIGN KEY (group_id, salon_id)
        REFERENCES booking_groups(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE customer_booking_services (
    booking_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    price_at_booking NUMERIC(12, 2) NOT NULL CHECK (price_at_booking >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (booking_id, service_id),
    FOREIGN KEY (booking_id, salon_id)
        REFERENCES customer_bookings(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE customer_booking_staff (
    booking_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED'
        CHECK (status IN ('ASSIGNED', 'CONFIRMED', 'DECLINED', 'COMPLETED')),
    assigned_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (booking_id, service_id, membership_id),
    FOREIGN KEY (booking_id, salon_id)
        REFERENCES customer_bookings(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE queue_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    booking_id UUID UNIQUE,
    entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('WALK_IN', 'APPOINTMENT')),
    preferred_time TIMESTAMPTZ,
    estimated_duration_minutes INTEGER NOT NULL CHECK (estimated_duration_minutes > 0),
    arrival_time TIMESTAMPTZ,
    actual_start_time TIMESTAMPTZ,
    actual_end_time TIMESTAMPTZ,
    priority SMALLINT NOT NULL DEFAULT 0,
    position INTEGER NOT NULL CHECK (position > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING'
        CHECK (status IN ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
    customer_choice_stylist BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id),
    FOREIGN KEY (booking_id, salon_id)
        REFERENCES customer_bookings(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE queue_entry_services (
    entry_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    service_id UUID NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    PRIMARY KEY (entry_id, service_id),
    FOREIGN KEY (entry_id, salon_id)
        REFERENCES queue_entries(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE queue_entry_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    service_id UUID NOT NULL,
    planned_start TIMESTAMPTZ,
    planned_end TIMESTAMPTZ,
    actual_start TIMESTAMPTZ,
    actual_end TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED'
        CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id, salon_id)
        REFERENCES queue_entries(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, salon_id)
        REFERENCES salon_services(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE stylist_states (
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    membership_id UUID NOT NULL,
    current_status VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (current_status IN ('AVAILABLE', 'BUSY', 'ON_BREAK', 'EMERGENCY_LEAVE')),
    current_entry_id UUID,
    next_break_start TIMESTAMPTZ,
    break_duration_minutes INTEGER CHECK (break_duration_minutes IS NULL OR break_duration_minutes > 0),
    preferred_break_window VARCHAR(30),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (salon_id, membership_id),
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (current_entry_id, salon_id)
        REFERENCES queue_entries(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_break_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    original_start TIMESTAMPTZ,
    actual_start TIMESTAMPTZ,
    shift_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE queue_conflict_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
    original_time TIMESTAMPTZ,
    shifted_time TIMESTAMPTZ,
    reason TEXT NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX customer_bookings_one_active_per_day_idx
    ON customer_bookings (customer_account_id, appointment_date)
    WHERE status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS');

CREATE UNIQUE INDEX queue_entries_one_active_per_customer_idx
    ON queue_entries (customer_account_id)
    WHERE status IN ('WAITING', 'IN_PROGRESS');

CREATE UNIQUE INDEX queue_entries_waiting_position_idx
    ON queue_entries (salon_id, position)
    WHERE status = 'WAITING';

CREATE INDEX customer_bookings_salon_date_idx
    ON customer_bookings (salon_id, appointment_date, status);
CREATE INDEX queue_entries_salon_status_priority_idx
    ON queue_entries (salon_id, status, priority DESC, position);
CREATE INDEX queue_entry_staff_schedule_idx
    ON queue_entry_staff (salon_id, membership_id, planned_start);

COMMIT;
