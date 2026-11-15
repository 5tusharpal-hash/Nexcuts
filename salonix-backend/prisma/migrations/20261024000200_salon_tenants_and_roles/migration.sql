BEGIN;

CREATE TABLE salon_organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    UNIQUE (id, name)
);

CREATE TABLE salons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    branch_code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    address_line_1 TEXT,
    address_line_2 TEXT,
    city VARCHAR(120),
    state VARCHAR(120),
    postal_code VARCHAR(24),
    country_code CHAR(2) NOT NULL DEFAULT 'IN',
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    UNIQUE (organization_id, branch_code),
    UNIQUE (id, organization_id)
);

CREATE TABLE salon_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'ENDED')),
    invited_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    joined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, account_id),
    UNIQUE (id, organization_id),
    UNIQUE (id, organization_id, account_id)
);

CREATE TABLE salon_organization_owners (
    organization_id UUID PRIMARY KEY REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    membership_id UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, organization_id),
    FOREIGN KEY (membership_id, organization_id, account_id)
        REFERENCES salon_memberships(id, organization_id, account_id)
        ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE salon_permissions (
    key VARCHAR(120) PRIMARY KEY,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salon_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE CASCADE,
    key VARCHAR(80) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, key),
    UNIQUE (id, organization_id)
);

CREATE TABLE salon_role_permissions (
    role_id UUID NOT NULL REFERENCES salon_roles(id) ON DELETE CASCADE,
    permission_key VARCHAR(120) NOT NULL REFERENCES salon_permissions(key) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE salon_membership_locations (
    membership_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    assigned_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (membership_id, salon_id),
    FOREIGN KEY (membership_id, organization_id)
        REFERENCES salon_memberships(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (salon_id, organization_id)
        REFERENCES salons(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE salon_membership_roles (
    membership_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    salon_id UUID,
    role_id UUID NOT NULL,
    assigned_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (membership_id, role_id, salon_id),
    FOREIGN KEY (membership_id, organization_id)
        REFERENCES salon_memberships(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (role_id, organization_id)
        REFERENCES salon_roles(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (salon_id, organization_id)
        REFERENCES salons(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE CASCADE
);

INSERT INTO salon_permissions (key, description) VALUES
    ('salon:edit', 'Update salon and branch settings'),
    ('salon:manage_members', 'Invite and manage salon employees'),
    ('salon:manage_roles', 'Create roles and assign permissions'),
    ('services:manage', 'Manage salon services and pricing'),
    ('staff:manage', 'Manage staff profiles, skills, and availability'),
    ('bookings:manage', 'Manage customer bookings'),
    ('queue:view', 'View the live queue'),
    ('queue:manage', 'Manage queue entries and assignments'),
    ('inventory:manage', 'Manage salon products and stock'),
    ('offers:manage', 'Manage packages, combos, and loyalty'),
    ('billing:view', 'View salon bills and financial reports'),
    ('billing:manage', 'Manage bills, payments, and refunds'),
    ('marketing:manage', 'Manage salon marketing campaigns')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX salon_memberships_account_idx ON salon_memberships (account_id);
CREATE INDEX salon_membership_locations_salon_idx
    ON salon_membership_locations (salon_id, membership_id);
CREATE INDEX salon_membership_roles_scope_idx
    ON salon_membership_roles (organization_id, salon_id, membership_id);

COMMIT;
