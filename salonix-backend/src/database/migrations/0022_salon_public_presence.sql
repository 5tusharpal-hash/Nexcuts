-- Migration: 0022_salon_public_presence.sql
-- Description: Implements the public-facing side of the salon (SEO, Gallery, and Public Profiles).
-- These tables are managed by the salon but consumed by the customer.

-- 1. Salon Public Profiles (For SEO and Discovery)
CREATE TABLE IF NOT EXISTS salon_public_profiles (
    salon_id UUID PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
    slug VARCHAR(255) UNIQUE NOT NULL, -- e.g., 'royal-cuts-mumbai'
    public_description TEXT,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(255),
    address_text TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Gallery Categories (Defined by the Salon)
CREATE TABLE IF NOT EXISTS salon_gallery_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    category_name VARCHAR(100) NOT NULL, -- e.g., 'Bridal', 'Haircut'
    display_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Gallery Images
CREATE TABLE IF NOT EXISTS salon_gallery_images (
    id UUID PRIMARY KEY DEFAULT gen_random_// uuid(),
    category_id UUID NOT NULL REFERENCES salon_gallery_categories(id) ON DELETE CASCADE,
    salon_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    alt_text TEXT,
    is_featured BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indices for SEO and Search
CREATE INDEX idx_salon_slug ON salon_public_profiles(slug);
CREATE INDEX idx_gallery_salon ON salon_gallery_images(salon_id);
CREATE INDEX idx_gallery_cat ON salon_gallery_images(category_id);
