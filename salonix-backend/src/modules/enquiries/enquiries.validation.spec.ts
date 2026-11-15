import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createEnquirySchema,
    enquiryListQuerySchema,
    updateEnquiryStatusSchema,
} from './enquiries.validation.js';

test('public enquiries require valid customer contact data', () => {
    const input = createEnquirySchema.parse({
        customerName: 'Customer',
        customerPhone: '+919876543210',
        customerEmail: 'customer@example.com',
        message: 'Please share details about this service.',
    });
    assert.equal(input.customerPhone, '+919876543210');
    assert.equal(
        createEnquirySchema.safeParse({
            customerName: 'Customer',
            customerPhone: '9876543210',
            message: 'Please contact me.',
        }).success,
        false
    );
});

test('enquiry lists use bounded pagination and exclude booking conversion', () => {
    assert.deepEqual(enquiryListQuerySchema.parse({}), {
        limit: 50,
        offset: 0,
    });
    assert.equal(
        enquiryListQuerySchema.safeParse({ status: 'CONVERTED' }).success,
        false
    );
    assert.equal(
        updateEnquiryStatusSchema.safeParse({ status: 'NEW' }).success,
        false
    );
});
