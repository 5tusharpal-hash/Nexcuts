BEGIN;

CREATE TABLE notification_templates (
    id VARCHAR(80) PRIMARY KEY,
    title_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    priority VARCHAR(12) NOT NULL DEFAULT 'NORMAL'
        CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_notification_preferences (
    customer_account_id UUID PRIMARY KEY
        REFERENCES customer_profiles(account_id) ON DELETE CASCADE,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account_device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('IOS', 'ANDROID', 'WEB')),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, device_token)
);

CREATE TABLE account_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    salon_id UUID REFERENCES salons(id) ON DELETE SET NULL,
    template_id VARCHAR(80) REFERENCES notification_templates(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'IN_APP'
        CHECK (channel IN ('IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP')),
    priority VARCHAR(12) NOT NULL DEFAULT 'NORMAL'
        CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'READ')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salon_marketing_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    template_id VARCHAR(80) NOT NULL REFERENCES notification_templates(id) ON DELETE RESTRICT,
    target_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    scheduled_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'COMPLETED', 'CANCELLED')),
    created_by_membership_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_marketing_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES salon_marketing_campaigns(id) ON DELETE CASCADE,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('WHATSAPP', 'SMS', 'EMAIL', 'PUSH')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ')),
    sent_at TIMESTAMPTZ,
    provider_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (campaign_id, customer_account_id, channel)
);

CREATE TABLE salon_enquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
    customer_account_id UUID REFERENCES customer_profiles(account_id) ON DELETE SET NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(32) NOT NULL,
    customer_email VARCHAR(320),
    service_interest TEXT,
    message TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'NEW'
        CHECK (status IN ('NEW', 'CONTACTED', 'NEGOTIATING', 'CONVERTED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id)
);

CREATE TABLE salon_enquiry_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enquiry_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    staff_membership_id UUID NOT NULL,
    note TEXT NOT NULL,
    is_external_reply BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (enquiry_id, salon_id)
        REFERENCES salon_enquiries(id, salon_id) ON DELETE CASCADE,
    FOREIGN KEY (staff_membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE salon_public_profiles (
    salon_id UUID PRIMARY KEY REFERENCES salons(id) ON DELETE CASCADE,
    slug VARCHAR(255) NOT NULL UNIQUE,
    public_description TEXT,
    contact_phone VARCHAR(32),
    contact_email VARCHAR(320),
    address_text TEXT,
    latitude NUMERIC(10, 8) CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(11, 8) CHECK (longitude BETWEEN -180 AND 180),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salon_gallery_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    category_name VARCHAR(100) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, salon_id)
);

CREATE TABLE salon_gallery_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    category_id UUID NOT NULL,
    image_url TEXT NOT NULL,
    alt_text TEXT,
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id, salon_id)
        REFERENCES salon_gallery_categories(id, salon_id) ON DELETE CASCADE
);

CREATE TABLE customer_salon_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    bill_id UUID NOT NULL,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (bill_id, customer_account_id),
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT
);

CREATE TABLE customer_staff_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL,
    bill_id UUID NOT NULL,
    customer_account_id UUID NOT NULL REFERENCES customer_profiles(account_id) ON DELETE RESTRICT,
    staff_membership_id UUID NOT NULL,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (bill_id, customer_account_id, staff_membership_id),
    FOREIGN KEY (bill_id, salon_id)
        REFERENCES pos_bills(id, salon_id) ON DELETE RESTRICT,
    FOREIGN KEY (staff_membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE INDEX account_notifications_history_idx
    ON account_notifications (account_id, created_at DESC);
CREATE INDEX salon_marketing_campaigns_schedule_idx
    ON salon_marketing_campaigns (salon_id, status, scheduled_at);
CREATE INDEX salon_enquiries_status_idx
    ON salon_enquiries (salon_id, status, created_at DESC);
CREATE INDEX salon_gallery_images_order_idx
    ON salon_gallery_images (salon_id, category_id, display_order);

COMMIT;
