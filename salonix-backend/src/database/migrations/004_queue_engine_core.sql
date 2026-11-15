-- Migration: 004_queue_engine_core.sql
-- Description: Implements a dynamic, human-managed queue system with flexible timing and resource orchestration.

-- 1. Stylist State Table (Real-time tracking)
CREATE TABLE IF NOT EXISTS stylist_states (
    stylist_id UUID PRIMARY KEY REFERENCES users(id),
    current_status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE, BUSY, ON_BREAK, EMERGENCY_LEAVE
    current_entry_id UUID, -- Currently serving customer
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_status CHECK (current_status IN ('AVAILABLE', 'BUSY', 'ON_BREAK', 'EMERGENCY_LEAVE'))
);

-- 2. Queue Entries Table (The Heart of the System)
CREATE TABLE IF NOT EXISTS queue_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id),
    stylist_id UUID REFERENCES users(id), -- Nullable for system assignment
    service_ids JSONB NOT NULL, -- Array of service IDs
    entry_type VARCHAR(20) NOT NULL, -- WALK_IN, APPOINTMENT

    -- Timing Logic
    preferred_time TIMESTAMP WITH TIME ZONE, -- Estimated target time
    estimated_duration INT NOT NULL, -- In minutes
    arrival_time TIMESTAMP WITH TIME ZONE, -- Actual check-in time
    actual_start_time TIMESTAMP WITH TIME ZONE,
    actual_end_time TIMESTAMP WITH TIME ZONE,
    booking_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, -- Original booking order

    -- Position and Constraints
    position INT NOT NULL, -- Rank in the current stylist's line
    customer_choice_stylist BOOLEAN DEFAULT FALSE, -- True if customer explicitly picked the stylist
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING', -- WAITING, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_entry_type CHECK (entry_type IN ('WALK_IN', 'APPOINTMENT')),
    CONSTRAINT chk_status CHECK (status IN ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'))
);

-- 3. Conflict Alerts Table (For Owner Monitoring)
CREATE TABLE IF NOT EXISTS conflict_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES queue_entries(id),
    original_time TIMESTAMP WITH TIME ZONE,
    shifted_time TIMESTAMP WITH TIME ZONE,
    reason TEXT NOT NULL, -- "Stylist Emergency", "Service Add-on", "Gap Fill"
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indices for performance
CREATE INDEX idx_queue_stylist_pos ON queue_entries(stylist_id, position);
CREATE INDEX idx_queue_status ON queue_entries(status);
CREATE INDEX idx_queue_preferred_time ON queue_entries(preferred_time);
CREATE INDEX idx_stylist_state_status ON stylist_states(current_status);
