import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewPosRefundSchema } from './pos_billing.validation.js';

test('completing a POS refund requires confirmation that cash was paid', () => {
    assert.equal(
        reviewPosRefundSchema.safeParse({ status: 'COMPLETED' }).success,
        false
    );
    assert.equal(
        reviewPosRefundSchema.safeParse({
            status: 'COMPLETED',
            cashPayoutConfirmed: true,
            payoutReference: 'CASH-REFUND-42',
        }).success,
        true
    );
});

test('cancelling a POS refund requires a reason and does not require payout confirmation', () => {
    assert.equal(
        reviewPosRefundSchema.safeParse({ status: 'CANCELLED' }).success,
        false
    );
    assert.equal(
        reviewPosRefundSchema.safeParse({
            status: 'CANCELLED',
            reason: 'Refund request withdrawn',
        }).success,
        true
    );
});
