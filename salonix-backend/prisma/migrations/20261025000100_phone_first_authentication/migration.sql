BEGIN;

ALTER TABLE accounts
    ALTER COLUMN email DROP NOT NULL;

ALTER TABLE accounts
    DROP CONSTRAINT accounts_status_check,
    ADD CONSTRAINT accounts_status_check
        CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
    ADD CONSTRAINT accounts_phone_number_e164_check
        CHECK (phone_number ~ '^\+[1-9][0-9]{6,14}$');

COMMIT;
