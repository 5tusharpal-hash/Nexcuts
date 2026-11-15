-- Migration: 0016_group_bookings_logic.sql
-- Description: Implements Group Booking functionality and links it to Queue and POS systems.

-- 1. Booking Groups Table
-- This acts as the container for multiple people booking together.
CREATE TABLE IF NOT EXISTS booking_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coordinator_id UUID NOT NULL REFERENCES users(id), -- The person the salon contacts and who pays
    group_name VARCHAR(100), -- e.g., 'Wedding Party', 'Family Visit'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, CANCELLED
    CONSTRAINT chk_group_status CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED'))
);

-- 2. Update Queue Entries to support groups
-- Each person in the group is still a separate entry for stylist assignment,
-- but they are linked to the same group.
ALTER TABLE queue_entries
ADD COLUMN group_id UUID REFERENCES booking_groups(id) ON DELETE SET NULL,
ADD COLUMN is_coordinator BOOLEAN DEFAULT FALSE;

-- 3. Update POS Bills to support group-level payment
-- We add group_id to the session so that the POS knows this is a group payment.
ALTER TABLE pos_billing_sessions
ADD COLUMN group_id UUID REFERENCES booking_groups(id) ON DELETE SET NULL;

-- Indices for performance
CREATE INDEX idx_queue_group ON queue_entries(group_id);
CREATE INDEX idx_session_group ON pos_billing_sessions(group_id);
CREATE INDEX idx_group_coordinator ON booking_groups(coordinator_id);
