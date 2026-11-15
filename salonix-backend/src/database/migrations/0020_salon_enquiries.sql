-- Migration: 0020_salon_enquiries.sql
-- Description: Implements the Enquiry and Lead Management system.

-- 1. Salon Enquiries Table
CREATE TABLE IF NOT EXISTS salon_enquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    customer_email VARCHAR(255),
    service_interest TEXT, -- Could be a list of service IDs or a general description
    message TEXT,
    status VARCHAR(20) DEFAULT 'NEW', -- NEW, CONTACTED, NEGOTIATING, CONVERTED, CLOSED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_enquiry_status CHECK (status IN ('NEW', 'CONTACTED', 'NEGOTIATING', 'CONVERTED', 'CLOSED'))
);

-- 2. Enquiry Responses / Notes
-- Used to track the conversation history between the salon and the lead.
CREATE TABLE IF NOT EXISTS enquiry_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enquiry_id UUID NOT NULL REFERENCES salon_enquiries(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES users(id),
    note TEXT NOT NULL,
    is_external_reply BOOLEAN DEFAULT FALSE, -- True if this was sent to the customer
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_enquiry_branch ON salon_enquiries(branch_id);
CREATE INDEX idx_enquiry_status ON salon_enquiries(status);
CREATE INDEX idx_response_enquiry ON enquiry_responses(enquiry_id);
