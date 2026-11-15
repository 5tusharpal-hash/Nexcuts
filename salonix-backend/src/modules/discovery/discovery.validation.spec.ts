import assert from 'node:assert/strict';
import test from 'node:test';
import {
    discoveryQuerySchema,
    publicSalonSlugSchema,
    salonSearchQuerySchema,
} from './discovery.validation.js';

test('public salon slugs are bounded and non-empty', () => {
    assert.equal(publicSalonSlugSchema.safeParse('central-salon').success, true);
    assert.equal(publicSalonSlugSchema.safeParse(' ').success, false);
    assert.equal(publicSalonSlugSchema.safeParse('a'.repeat(256)).success, false);
});

test('public gallery pagination is bounded and defaults safely', () => {
    assert.deepEqual(discoveryQuerySchema.parse({}), { limit: 50, offset: 0 });
    assert.equal(discoveryQuerySchema.safeParse({ limit: '101' }).success, false);
    assert.equal(discoveryQuerySchema.safeParse({ offset: '-1' }).success, false);
});

test('public salon search requires at least one supported search filter', () => {
    assert.deepEqual(
        salonSearchQuerySchema.parse({ city: 'Pune' }),
        { city: 'Pune', limit: 50, offset: 0 }
    );
    assert.equal(salonSearchQuerySchema.safeParse({}).success, false);
    assert.equal(
        salonSearchQuerySchema.safeParse({ service: 'a'.repeat(121) }).success,
        false
    );
});
