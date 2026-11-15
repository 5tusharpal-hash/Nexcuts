import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createSalonTaxRateSchema,
    updateSalonTaxRateSchema,
} from './salon_tax_rates.validation.js';

test('salon tax rates support no-tax and category-specific defaults', () => {
    assert.deepEqual(
        createSalonTaxRateSchema.parse({
            name: 'No GST',
            itemType: 'PRODUCT',
            rate: 0,
        }),
        {
            name: 'No GST',
            itemType: 'PRODUCT',
            rate: 0,
            isActive: true,
        }
    );
    assert.equal(
        createSalonTaxRateSchema.safeParse({
            name: 'Service GST',
            itemType: 'SERVICE',
            rate: 18,
            isActive: false,
        }).success,
        true
    );
});

test('salon tax rate inputs reject unsupported categories and empty patches', () => {
    assert.equal(
        createSalonTaxRateSchema.safeParse({
            name: 'SMS Tax',
            itemType: 'SMS',
            rate: 18,
        }).success,
        false
    );
    assert.equal(updateSalonTaxRateSchema.safeParse({}).success, false);
    assert.equal(
        updateSalonTaxRateSchema.safeParse({ rate: 101 }).success,
        false
    );
});
