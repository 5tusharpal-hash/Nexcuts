-- Migration: 008_staff_management.sql
-- Description: Implements stylist profiles, skill mapping, attendance, and performance.

-- 1. Stylist Professional Profiles
CREATE TABLE IF NOT EXISTS stylist_profiles (
    stylist_id UUID PRIMARY KEY REFERENCES users(id),
    full_name VARCHAR(255) NOT NULL,
    bio TEXT,
    profile_image TEXT,
    experience_years INT,
    serve_type VARCHAR(20) NOT NULL, -- MEN, WOMEN, UNISEX
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_serve_type CHECK (serve_type IN ('MEN', 'WOMEN', 'UNISEX'))
);

-- 2. Skill Matrix (Many-to-Many: Stylist <-> Service)
CREATE TABLE IF NOT EXISTS stylist_skills (
    stylist_id UUID REFERENCES stylist_profiles(stylist_id),
    service_id UUID REFERENCES services(id),
    proficiency_level VARCHAR(20) DEFAULT 'STANDARD', -- STANDARD, EXPERT, MASTER
    PRIMARY KEY (stylist_id, service_id)
);

-- 3. Attendance & Timesheets
CREATE TABLE IF NOT EXISTS staff_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stylist_id UUID REFERENCES stylist_profiles(stylist_id),
    check_in TIMESTAMP WITH TIME ZONE NOT NULL,
    check_out TIMESTAMP WITH TIME ZONE,
    total_work_hours DECIMAL(5, 2),
    status VARCHAR(20) DEFAULT 'PRESENT', -- PRESENT, ABSENT, LEAVE, LATE
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Performance Metrics (Aggregated Data)
CREATE TABLE IF NOT EXISTS stylist_metrics (
    stylist_id UUID PRIMARY KEY REFERENCES stylist_profiles(stylist_id),
    total_billed_amount DECIMAL(15, 2) DEFAULT 0,
    completed_services_count INT DEFAULT 0,
    repeat_customer_count INT DEFAULT 0,
    average_rating DECIMAL(3, 2) DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_skills_stylist ON stylist_skills(stylist_id);
CREATE INDEX idx_skills_service ON stylist_skills(service_id);
CREATE INDEX idx_attendance_date ON staff_attendance(check_in);
