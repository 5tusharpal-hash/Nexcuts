-- Migration: 0018_reviews_ratings.sql
-- Description: Implements a two-tier review system for the salon and individual stylists.

-- 1. Salon Reviews (Overall Experience)
CREATE TABLE IF NOT EXISTS salon_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES pos_bills(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    rating INT NOT NULL, -- 1 to 5 stars
    comment TEXT,
    is_public BOOLEAN DEFAULT FALSE, -- True if shared to Google/Publicly
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_salon_rating CHECK (rating BETWEEN 1 AND 5)
);

-- 2. Stylist Reviews (Individual Performance)
CREATE TABLE IF NOT EXISTS stylist_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES pos_bills(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    stylist_id UUID NOT NULL REFERENCES users(id),
    rating INT NOT NULL, -- 1 to 5 stars
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_stylist_rating CHECK (rating BETWEEN 1 AND 5)
);

-- Indices for performance
CREATE INDEX idx_salon_reviews_bill ON salon_reviews(bill_id);
CREATE INDEX idx_stylist_reviews_stylist ON stylist_reviews(stylist_id);
CREATE INDEX idx_stylist_reviews_bill ON stylist_reviews(bill_id);
