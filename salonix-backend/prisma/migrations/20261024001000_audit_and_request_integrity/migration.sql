BEGIN;

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    actor_context VARCHAR(20) NOT NULL
        CHECK (actor_context IN ('CUSTOMER', 'SALON', 'PLATFORM', 'ADMIN', 'SYSTEM')),
    organization_id UUID REFERENCES salon_organizations(id) ON DELETE SET NULL,
    salon_id UUID REFERENCES salons(id) ON DELETE SET NULL,
    action VARCHAR(120) NOT NULL,
    resource_type VARCHAR(120) NOT NULL,
    resource_id TEXT,
    request_id VARCHAR(120),
    ip_address INET,
    user_agent TEXT,
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_status SMALLINT,
    response_body JSONB,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, key)
);

CREATE TABLE salon_membership_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    salon_id UUID NOT NULL,
    email VARCHAR(320) NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    role_id UUID NOT NULL,
    invited_by_membership_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_by_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (email = lower(email)),
    FOREIGN KEY (role_id, organization_id)
        REFERENCES salon_roles(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (salon_id, organization_id)
        REFERENCES salons(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (invited_by_membership_id, salon_id)
        REFERENCES salon_membership_locations(membership_id, salon_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX salon_membership_invitations_pending_email_idx
    ON salon_membership_invitations (organization_id, salon_id, email)
    WHERE status = 'PENDING';

CREATE INDEX audit_logs_actor_created_idx
    ON audit_logs (actor_account_id, created_at DESC);
CREATE INDEX audit_logs_resource_idx
    ON audit_logs (resource_type, resource_id, created_at DESC);
CREATE INDEX audit_logs_tenant_created_idx
    ON audit_logs (organization_id, salon_id, created_at DESC);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

COMMIT;
