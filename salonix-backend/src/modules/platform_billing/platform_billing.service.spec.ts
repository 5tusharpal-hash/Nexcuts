import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlatformBillingRepository } from './platform_billing.repository.js';

type AddonPurchaseSetup = Awaited<ReturnType<PlatformBillingRepository['createAddonPurchase']>>;

test('next-cycle add-on retry without a provider returns the pending invoice state', async () => {
    process.env.NODE_ENV = 'test';
    if (!process.env.DATABASE_URL) {
        process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    }
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
    }

    const [{ PlatformBillingRepository }, { PlatformBillingService }] = await Promise.all([
        import('./platform_billing.repository.js'),
        import('./platform_billing.service.js'),
    ]);
    class AddonPurchaseRepositoryStub extends PlatformBillingRepository {
        constructor(private readonly purchase: AddonPurchaseSetup) {
            super();
        }

        override async createAddonPurchase() {
            return this.purchase;
        }
    }

    const purchase: AddonPurchaseSetup = {
        purchaseId: 'purchase-id',
        salonId: 'salon-id',
        addonId: 'addon-id',
        activationMode: 'NEXT_CYCLE',
        status: 'PENDING_PAYMENT',
        amount: 500,
        effectiveAt: '2026-01-01',
        invoiceId: 'invoice-id',
    };
    const service = new PlatformBillingService(new AddonPurchaseRepositoryStub(purchase));

    const result = await service.purchaseAddon(
        purchase.salonId,
        purchase.addonId,
        { activationMode: 'NEXT_CYCLE' },
        'retry-key-123'
    );

    assert.deepEqual(result, purchase);
});
