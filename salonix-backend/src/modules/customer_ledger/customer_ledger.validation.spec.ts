import assert from 'node:assert/strict';
import test from 'node:test';
import {
    customerLedgerBillParamsSchema,
    customerLedgerQuerySchema,
} from './customer_ledger.validation.js';

test('customer ledger pagination is bounded and defaults safely', () => {
    assert.deepEqual(customerLedgerQuerySchema.parse({}), { limit: 50, offset: 0 });
    assert.deepEqual(customerLedgerQuerySchema.parse({ limit: '25', offset: '10' }), {
        limit: 25,
        offset: 10,
    });
    assert.equal(customerLedgerQuerySchema.safeParse({ limit: '101' }).success, false);
    assert.equal(customerLedgerQuerySchema.safeParse({ offset: '-1' }).success, false);
});

test('customer ledger bill identifiers must be UUIDs', () => {
    assert.equal(
        customerLedgerBillParamsSchema.safeParse({
            billId: '00000000-0000-0000-0000-000000000000',
        }).success,
        true
    );
    assert.equal(
        customerLedgerBillParamsSchema.safeParse({ billId: 'not-a-uuid' }).success,
        false
    );
});
