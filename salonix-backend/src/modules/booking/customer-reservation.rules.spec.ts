import assert from 'node:assert/strict';
import test from 'node:test';
import { indiaDayKey, intervalsOverlap } from './customer-reservation.rules.js';

test('customer reservations that overlap across salons are rejected', () => {
    const first = { startsAt: new Date('2026-11-06T06:30:00.000Z'), durationMinutes: 60 };
    const second = { startsAt: new Date('2026-11-06T07:00:00.000Z'), durationMinutes: 30 };
    assert.equal(intervalsOverlap(first, second), true);
});

test('adjacent customer reservations do not overlap', () => {
    const first = { startsAt: new Date('2026-11-06T06:30:00.000Z'), durationMinutes: 30 };
    const second = { startsAt: new Date('2026-11-06T07:00:00.000Z'), durationMinutes: 30 };
    assert.equal(intervalsOverlap(first, second), false);
});

test('future preferred time on a different calendar day is allowed without replacement', () => {
    assert.notEqual(
        indiaDayKey(new Date('2026-11-05T18:30:00.000Z')),
        indiaDayKey(new Date('2026-11-06T18:30:00.000Z')),
    );
});

test('midnight UTC maps to the correct India calendar day', () => {
    assert.equal(indiaDayKey(new Date('2026-11-05T18:30:00.000Z')), '2026-11-06');
});
