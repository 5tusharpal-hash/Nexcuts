import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    completeTipRefundRequestSchema,
    createTipRefundRequestSchema,
    createLeaveRequestSchema,
    createTipRequestSchema,
    dateRangeQuerySchema,
    reviewTipRefundRequestSchema,
    tipRefundListQuerySchema,
} from './employee_management.validation.js';

test('employee date ranges require valid ordered dates and bounded pagination', () => {
    assert.equal(
        dateRangeQuerySchema.safeParse({
            from: '2026-10-01',
            to: '2026-10-31',
        }).success,
        true
    );
    assert.equal(
        dateRangeQuerySchema.safeParse({
            from: '2026-10-31',
            to: '2026-10-01',
        }).success,
        false
    );
    assert.equal(
        dateRangeQuerySchema.safeParse({
            from: '2026-10-01',
            to: '2026-10-31',
            limit: 101,
        }).success,
        false
    );
});

test('leave requests require valid date order and half-day increments within the range', () => {
    const validRequest = {
        leaveTypeId: '00000000-0000-0000-0000-000000000000',
        startsOn: '2026-10-05',
        endsOn: '2026-10-06',
        requestedDays: 1.5,
        reason: 'Family appointment',
    };
    assert.equal(createLeaveRequestSchema.safeParse(validRequest).success, true);
    assert.equal(
        createLeaveRequestSchema.safeParse({
            ...validRequest,
            requestedDays: 1.25,
        }).success,
        false
    );
    assert.equal(
        createLeaveRequestSchema.safeParse({
            ...validRequest,
            startsOn: '2026-10-07',
        }).success,
        false
    );
});

test('tip requests require a positive amount and idempotency key', () => {
    const validRequest = {
        billId: '00000000-0000-0000-0000-000000000000',
        membershipId: '00000000-0000-0000-0000-000000000000',
        amount: 25,
        idempotencyKey: 'tip-request-001',
    };
    assert.equal(createTipRequestSchema.safeParse(validRequest).success, true);
    assert.equal(
        createTipRequestSchema.safeParse({
            ...validRequest,
            amount: 0,
        }).success,
        false
    );
    const { idempotencyKey: _, ...withoutIdempotencyKey } = validRequest;
    assert.equal(createTipRequestSchema.safeParse(withoutIdempotencyKey).success, false);
});

test('tip refund requests require an approved-tip reference, amount, reason, and idempotency key', () => {
    const validRequest = {
        tipRequestId: '00000000-0000-0000-0000-000000000000',
        amount: 15,
        reason: 'Customer requested a partial tip refund',
        idempotencyKey: 'tip-refund-001',
    };
    assert.equal(createTipRefundRequestSchema.safeParse(validRequest).success, true);
    assert.equal(
        createTipRefundRequestSchema.safeParse({
            ...validRequest,
            amount: 0,
        }).success,
        false
    );
    assert.equal(
        createTipRefundRequestSchema.safeParse({
            ...validRequest,
            amount: 10.005,
        }).success,
        false
    );
    assert.equal(
        createTipRefundRequestSchema.safeParse({
            ...validRequest,
            reason: ' ',
        }).success,
        false
    );
});

test('tip refund review and completion accept only valid states and bounded payout metadata', () => {
    assert.equal(
        reviewTipRefundRequestSchema.safeParse({ status: 'APPROVED' }).success,
        true
    );
    assert.equal(
        reviewTipRefundRequestSchema.safeParse({ status: 'COMPLETED' }).success,
        false
    );
    assert.equal(
        completeTipRefundRequestSchema.safeParse({
            payoutReference: 'bank-ref-123',
            note: 'Refund sent to original payment method',
        }).success,
        true
    );
    assert.equal(
        completeTipRefundRequestSchema.safeParse({ payoutReference: ' ' }).success,
        false
    );
    assert.equal(
        tipRefundListQuerySchema.safeParse({
            from: '2026-10-01',
            to: '2026-10-31',
            status: 'PAYOUT_PENDING',
        }).success,
        true
    );
});
