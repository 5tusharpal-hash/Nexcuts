-- Migration: 005_floating_breaks.sql
-- Description: Implements floating breaks and enhanced resource tracking for human-like scheduling.

-- 1. Update stylist_states to handle floating breaks
ALTER TABLE stylist_states
ADD COLUMN next_break_start TIMESTAMP WITH TIME ZONE,
ADD COLUMN break_duration INT DEFAULT 60, -- In minutes
ADD COLUMN preferred_break_window VARCHAR(20) DEFAULT 'LUNCH'; -- LUNCH, TEA, etc.

-- 2. Break Logs to track how breaks were shifted
CREATE TABLE IF NOT EXISTS break_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stylist_id UUID NOT NULL REFERENCES users(id),
    original_start TIMESTAMP WITH TIME ZONE,
    actual_start TIMESTAMP WITH TIME ZONE,
    shift_reason TEXT, -- e.g., "Long service at 1:00 PM"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Update queue_entries to better support walk-ins
ALTER TABLE queue_entries
ADD COLUMN is_walk_in BOOLEAN DEFAULT FALSE;

CREATE INDEX idx_break_start ON stylist_states(next_break_start);
