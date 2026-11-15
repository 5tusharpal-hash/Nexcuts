import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createMarketingCampaignSchema,
    queueJoinConsentSchema,
    sendMarketingCampaignSchema,
} from './marketing.validation.js';

test('queue join requires an explicit marketing consent decision', () => {
    const serviceId = 'c4bcb559-7293-4f4e-9f7a-f47a1a46ef40';
    assert.deepEqual(
        queueJoinConsentSchema.parse({ serviceId, marketingConsent: false }),
        { serviceId, marketingConsent: false }
    );
    assert.equal(queueJoinConsentSchema.safeParse({ serviceId }).success, false);
    assert.equal(
        queueJoinConsentSchema.safeParse({
            serviceId,
            marketingConsent: true,
            priority: 'VIP',
        }).success,
        false
    );
});

test('marketing campaign scheduling accepts future ISO timestamps and channels', () => {
    assert.deepEqual(
        createMarketingCampaignSchema.parse({
            name: 'Weekend offer',
            titleTemplate: 'Hello {{name}}',
            bodyTemplate: 'Book this weekend and save.',
            scheduledAt: '2027-01-01T10:00:00.000Z',
            channels: ['IN_APP', 'EMAIL'],
        }),
        {
            name: 'Weekend offer',
            titleTemplate: 'Hello {{name}}',
            bodyTemplate: 'Book this weekend and save.',
            scheduledAt: '2027-01-01T10:00:00.000Z',
            channels: ['IN_APP', 'EMAIL'],
        }
    );
    assert.equal(createMarketingCampaignSchema.safeParse({
        name: 'Invalid campaign',
        titleTemplate: 'Hello',
        bodyTemplate: 'Body',
        scheduledAt: 'tomorrow',
        channels: ['SMS'],
    }).success, false);
    assert.equal(createMarketingCampaignSchema.safeParse({
        name: 'Duplicate channels',
        titleTemplate: 'Hello',
        bodyTemplate: 'Body',
        channels: ['EMAIL', 'EMAIL'],
    }).success, false);
});

test('marketing dispatch only accepts supported channels and bounded batches', () => {
    assert.deepEqual(
        sendMarketingCampaignSchema.parse({ channel: 'EMAIL' }),
        { channel: 'EMAIL', limit: 50 }
    );
    assert.equal(
        sendMarketingCampaignSchema.safeParse({ channel: 'SMS' }).success,
        false
    );
    assert.equal(
        sendMarketingCampaignSchema.safeParse({ channel: 'WHATSAPP', limit: 101 }).success,
        false
    );
});
