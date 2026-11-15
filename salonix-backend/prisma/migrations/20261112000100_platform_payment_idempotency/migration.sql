BEGIN;

ALTER TABLE platform_payments
    ADD COLUMN idempotency_key VARCHAR(255),
    ADD COLUMN checkout_claimed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX platform_payments_idempotency_key_idx
    ON platform_payments (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX platform_consolidated_bill_invoices_invoice_idx
    ON platform_consolidated_bill_invoices (invoice_id, consolidated_bill_id);

COMMIT;
