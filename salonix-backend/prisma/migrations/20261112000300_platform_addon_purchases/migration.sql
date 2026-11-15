BEGIN;

ALTER TABLE platform_salon_invoices
    ADD COLUMN invoice_kind VARCHAR(24) NOT NULL DEFAULT 'SUBSCRIPTION'
        CHECK (invoice_kind IN ('SUBSCRIPTION', 'ADDON_ADJUSTMENT'));

DO $$
DECLARE
    unique_constraint TEXT;
BEGIN
    SELECT conname
    INTO unique_constraint
    FROM pg_constraint
    WHERE conrelid = 'platform_salon_invoices'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) =
          'UNIQUE (salon_id, billing_period_start, billing_period_end)';

    IF unique_constraint IS NULL THEN
        RAISE EXCEPTION 'Expected salon billing-period uniqueness constraint was not found';
    END IF;

    EXECUTE format(
        'ALTER TABLE platform_salon_invoices DROP CONSTRAINT %I',
        unique_constraint
    );
END $$;

CREATE UNIQUE INDEX platform_salon_invoices_subscription_period_idx
    ON platform_salon_invoices (salon_id, billing_period_start, billing_period_end)
    WHERE invoice_kind = 'SUBSCRIPTION';

CREATE TABLE platform_addon_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES salon_organizations(id) ON DELETE RESTRICT,
    salon_id UUID NOT NULL,
    addon_id UUID NOT NULL REFERENCES platform_addons(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES platform_salon_invoices(id) ON DELETE RESTRICT,
    activation_mode VARCHAR(24) NOT NULL
        CHECK (activation_mode IN ('IMMEDIATE_PRORATED', 'NEXT_CYCLE')),
    status VARCHAR(24) NOT NULL DEFAULT 'SCHEDULED'
        CHECK (status IN ('SCHEDULED', 'PENDING_PAYMENT', 'ACTIVE', 'CANCELLED')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    effective_at DATE NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salon_id, organization_id)
        REFERENCES salons(id, organization_id) ON DELETE RESTRICT,
    UNIQUE (organization_id, idempotency_key),
    CHECK (
        status = 'CANCELLED'
        OR (status = 'SCHEDULED' AND invoice_id IS NULL)
        OR (status IN ('PENDING_PAYMENT', 'ACTIVE') AND invoice_id IS NOT NULL)
    )
);

CREATE INDEX platform_addon_purchases_scheduled_idx
    ON platform_addon_purchases (salon_id, effective_at)
    WHERE status = 'SCHEDULED';

COMMIT;
