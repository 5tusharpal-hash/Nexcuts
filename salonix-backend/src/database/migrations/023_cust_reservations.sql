-- Migration: 023_cust_reservations.sql
-- Description: Implements the customer reservation system for preferred time bookings.

CREATE TABLE IF NOT EXISTS cust_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    salon_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    preferred_date DATE NOT NULL,
    preferred_time TIME NOT NULL,
    estimated_duration INT NOT NULL, -- In minutes
    status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, CONFIRMED, CHECKED_IN, CANCELLED, NO_SHOW
    group_id UUID, -- Link to booking_groups for coordinated bookings
    is_coordinator BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_res_status CHECK (status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'))
);

-- Link reservations to services they want to take
CREATE TABLE IF NOT EXISTS cust_reservation_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES cust_reservations(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id),
    duration_override INT, -- In case the customer wants a longer version of a service
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_res_user_date ON cust_reservations(customer_id, preferred_date);
CREATE INDEX idx_res_salon_date ON cust_reservations(salon_id, preferred_date);
CREATE INDEX idx_res_status ON cust_reservations(status);
