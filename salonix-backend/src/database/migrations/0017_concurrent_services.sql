-- Migration: 0017_concurrent_services.sql
-- Description: Refactors Queue to support Asynchronous Concurrent Services.
-- Moves stylist assignment from a 1:1 to a 1:N relationship.

-- 1. Remove stylist_id from queue_entries as one entry can now have multiple stylists
ALTER TABLE queue_entries DROP COLUMN IF EXISTS stylist_id;

-- 2. Create the Mapping table for stylists on a single entry
CREATE TABLE IF NOT EXISTS queue_entry_stylists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
    stylist_id UUID NOT NULL REFERENCES users(id),
    service_id UUID NOT NULL REFERENCES services(id),
    planned_start TIMESTAMP WITH TIME ZONE,
    planned_end TIMESTAMP WITH TIME ZONE,
    actual_start TIMESTAMP WITH TIME ZONE,
    actual_end TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'SCHEDULED', -- SCHEDULED, IN_PROGRESS, COMPLETED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_stylist_status CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED'))
);

-- Indices for real-time lookup
CREATE INDEX idx_entry_stylists_entry ON queue_entry_stylists(entry_id);
CREATE INDEX idx_entry_stylists_stylist ON queue_entry_stylists(stylist_id);
CREATE INDEX idx_entry_stylists_status ON queue_entry_stylists(status);
