import assert from 'node:assert/strict';
import test from 'node:test';
import {
    branchAnalyticsQuerySchema,
    churnAlertQuerySchema,
} from './analytics.validation.js';

test('branch analytics query accepts a valid increasing date range', () => {
    const result = branchAnalyticsQuerySchema.parse({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
    });

    assert.ok(result.startDate instanceof Date);
    assert.ok(result.endDate instanceof Date);
});

test('branch analytics query rejects invalid and reversed dates', () => {
    assert.equal(
        branchAnalyticsQuerySchema.safeParse({
            startDate: 'invalid',
            endDate: '2026-01-31T23:59:59Z',
        }).success,
        false
    );
    assert.equal(
        branchAnalyticsQuerySchema.safeParse({
            startDate: '2026-01-31T23:59:59Z',
            endDate: '2026-01-01T00:00:00Z',
        }).success,
        false
    );
});

test('churn alert pagination is bounded', () => {
    assert.deepEqual(churnAlertQuerySchema.parse({}), { limit: 50, offset: 0 });
    assert.equal(churnAlertQuerySchema.safeParse({ limit: '101' }).success, false);
    assert.equal(churnAlertQuerySchema.safeParse({ offset: '-1' }).success, false);
});
