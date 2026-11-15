import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    allocatePointsFifo,
    calculateEffectiveExpiry,
    calculatePointsAward,
    calculateQualifyingSpend,
    calculateRefundReversal,
    InsufficientPointsError,
} from './loyalty.calculations.js';

test('minimum spend includes only the salon-selected bill categories', () => {
    const qualifyingSpend = calculateQualifyingSpend([
        { category: 'SERVICE', amount: 100 },
        { category: 'PRODUCT', amount: 200 },
        { category: 'PACKAGE', amount: 400 },
    ], ['SERVICE', 'PRODUCT']);

    assert.equal(qualifyingSpend, 300);
    assert.equal(calculatePointsAward(qualifyingSpend, 500, 10, 1), 0);
});

test('loyalty points use only the qualifying spend and respect the minimum', () => {
    assert.equal(calculatePointsAward(300, 500, 10, 1), 0);
    assert.equal(calculatePointsAward(700, 500, 10, 1), 70);
    assert.equal(calculatePointsAward(700, 500, 10, 2), 140);
});

test('refund reversal uses only the new refund and avoids points already reversed for it', () => {
    assert.equal(calculateRefundReversal(100, 50, 100, 0), 50);
    assert.equal(calculateRefundReversal(100, 50, 100, 25), 25);
    assert.equal(calculateRefundReversal(100, 120, 100, 0), 100);
    assert.equal(calculateRefundReversal(100, 50, 0, 0), 0);
});

test('closed programs cap a batch at the earlier of its expiry and the closure deadline', () => {
    const closureDeadline = new Date('2027-10-26T00:00:00.000Z');
    const earlierExpiry = new Date('2027-01-01T00:00:00.000Z');
    const laterExpiry = new Date('2028-01-01T00:00:00.000Z');

    assert.equal(calculateEffectiveExpiry(earlierExpiry, closureDeadline), earlierExpiry);
    assert.equal(calculateEffectiveExpiry(laterExpiry, closureDeadline), closureDeadline);
});

test('FIFO allocation consumes the earliest-expiring lots first', () => {
    const allocations = allocatePointsFifo([
        { id: 'first', remaining: 5, expiresAt: new Date('2026-12-01T00:00:00.000Z') },
        { id: 'second', remaining: 10, expiresAt: new Date('2027-01-01T00:00:00.000Z') },
    ], 8);

    assert.deepEqual(allocations, [
        { lotId: 'first', points: 5 },
        { lotId: 'second', points: 3 },
    ]);
});

test('FIFO allocation rejects a redemption larger than the available points', () => {
    assert.throws(
        () => allocatePointsFifo([
            { id: 'first', remaining: 5, expiresAt: new Date('2026-12-01T00:00:00.000Z') },
        ], 6),
        InsufficientPointsError
    );
});
