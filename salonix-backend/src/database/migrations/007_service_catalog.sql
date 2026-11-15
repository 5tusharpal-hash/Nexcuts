-- Migration: 007_service_catalog.sql
-- Description: Implements the service catalog with categories, duration, and automation rules.

CREATE TABLE IF NOT EXISTS service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES service_categories(id), -- For nested categories
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES service_categories(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    estimated_duration INT NOT NULL, -- In minutes, used by Queue Engine
    base_price DECIMAL(12, 2) NOT NULL,
    target_audience VARCHAR(20) NOT NULL, -- MEN, WOMEN, KIDS, UNISEX
    image_url TEXT,
    is_public BOOLEAN DEFAULT TRUE,

    -- Automation rules
    reminder_days INT, -- e.g., 30 for a monthly reminder
    automation_config JSONB, -- Additional rules for notifications

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_audience CHECK (target_audience IN ('MEN', 'WOMEN', 'KIDS', 'UNISEX'))
);

CREATE INDEX idx_service_category ON services(category_id);
CREATE INDEX idx_service_public ON services(is_public);
