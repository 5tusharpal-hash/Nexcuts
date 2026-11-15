import assert from 'node:assert/strict';
import test from 'node:test';
import {
    notificationPreferencesSchema,
    notificationQuerySchema,
} from './notifications.validation.js';

test('notification history pagination is bounded', () => {
    assert.deepEqual(notificationQuerySchema.parse({}), { limit: 50, offset: 0 });
    assert.equal(notificationQuerySchema.safeParse({ limit: '101' }).success, false);
    assert.equal(notificationQuerySchema.safeParse({ offset: '-1' }).success, false);
});

test('notification preferences require explicit channel choices', () => {
    assert.equal(
        notificationPreferencesSchema.safeParse({
            pushEnabled: true,
            emailEnabled: true,
            smsEnabled: false,
            whatsappEnabled: false,
        }).success,
        true
    );
    assert.equal(
        notificationPreferencesSchema.safeParse({ pushEnabled: true }).success,
        false
    );
});
