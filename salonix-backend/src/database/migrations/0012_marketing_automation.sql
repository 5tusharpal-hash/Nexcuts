-- Migration: 0012_marketing_automation.sql
-- Description: Implements the Marketing Automation system and Paid Module tracking.

-- 1. Marketing Campaigns
CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    name VARCHAR(255) NOT NULL,
    template_id VARCHAR(50) NOT NULL, -- Linked to notification_templates
    target_criteria JSONB, -- e.g., { "last_visit_days": 60, "min_spend": 1000 }
    scheduled_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'DRAFT', -- DRAFT, SCHEDULED, SENT, COMPLETED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_campaign_status CHECK (status IN ('DRAFT', 'SCHEDULED', 'SENT', 'COMPLETED'))
);

-- 2. Marketing Delivery Logs (Tracking Paid Channel usage)
CREATE TABLE IF NOT EXISTS marketing_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES marketing_campaigns(id),
    user_id UUID NOT NULL REFERENCES users(id),
    channel VARCHAR(20) NOT NULL, -- 'WHATSAPP', 'SMS', 'EMAIL'
    status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, DELIVERED, FAILED, READ
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_channel CHECK (channel IN ('WHATSAPP', 'SMS', 'EMAIL'))
);

-- 3. Marketing Feature Access (The Paid Module Check)
-- We use the existing platform_branch_add_ons table for the subscription,
-- but we add a specific flag for marketing capabilities here if needed,
-- or simply link to the 'Marketing' add-on ID.
ALTER TABLE platform_add_ons
ADD COLUMN is_marketing_module BOOLEAN DEFAULT FALSE;

CREATE INDEX idx_marketing_campaign_branch ON marketing_campaigns(branch_id);
CREATE INDEX idx_delivery_user ON marketing_delivery_logs(user_id);
CREATE INDEX idx_delivery_status ON marketing_delivery_logs(status);
