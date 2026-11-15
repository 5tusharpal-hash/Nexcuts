import { prisma } from '../../bootstrap/db.connect';
import { CustomerPlan } from './customer_plans.types';

export class CustomerPlanRepository {
    async findActivePlan(userId: string, salonId: string, serviceId: string): Promise<CustomerPlan | null> {
        const plans = await prisma.$queryRaw<CustomerPlanRow[]>`
            SELECT
                subscription.id,
                subscription.customer_account_id AS "userId",
                COALESCE(subscription.package_id, subscription.id) AS "planId",
                subscription.salon_id AS "salonId",
                subscription.status,
                COALESCE(
                    JSONB_OBJECT_AGG(balance.service_id::text, balance.used_count)
                        FILTER (WHERE balance.service_id IS NOT NULL),
                    '{}'::jsonb
                ) AS "usageData",
                subscription.created_at AS "purchaseDate",
                subscription.expires_at AS "expiryDate"
            FROM customer_package_subscriptions AS subscription
            LEFT JOIN customer_package_service_balances AS balance
              ON balance.subscription_id = subscription.id
             AND balance.salon_id = subscription.salon_id
            WHERE subscription.customer_account_id = ${userId}
              AND subscription.salon_id = ${salonId}
              AND subscription.payment_status = 'PAID'
              AND subscription.status = 'ACTIVE'
              AND subscription.expires_at > CURRENT_TIMESTAMP
              AND EXISTS (
                SELECT 1
                FROM customer_package_service_balances AS eligible
                WHERE eligible.subscription_id = subscription.id
                  AND eligible.service_id = ${serviceId}
                  AND (eligible.max_uses IS NULL OR eligible.used_count < eligible.max_uses)
              )
            GROUP BY subscription.id
            ORDER BY subscription.expires_at ASC
            LIMIT 1
        `;
        const plan = plans[0];
        if (!plan) return null;
        return {
            ...plan,
            status: plan.status as CustomerPlan['status'],
            usageData: plan.usageData ?? {},
        };
    }

    async updateUsage(planId: string, serviceId: string): Promise<void> {
        await prisma.$transaction(async (tx) => {
            const updated = await tx.$queryRaw<Array<{ subscriptionId: string }>>`
                UPDATE customer_package_service_balances
                SET used_count = used_count + 1
                WHERE subscription_id = ${planId}
                  AND service_id = ${serviceId}
                  AND EXISTS (
                    SELECT 1
                    FROM customer_package_subscriptions AS subscription
                    WHERE subscription.id = ${planId}
                      AND subscription.status = 'ACTIVE'
                      AND subscription.payment_status = 'PAID'
                      AND subscription.expires_at > CURRENT_TIMESTAMP
                  )
                  AND (max_uses IS NULL OR used_count < max_uses)
                RETURNING subscription_id AS "subscriptionId"
            `;
            if (!updated[0]) {
                throw new Error('Service is not covered by this plan or its usage limit is exhausted');
            }

            await tx.$executeRaw`
                UPDATE customer_package_subscriptions AS subscription
                SET status = 'EXHAUSTED'
                WHERE subscription.id = ${planId}
                  AND NOT EXISTS (
                    SELECT 1
                    FROM customer_package_service_balances AS balance
                    WHERE balance.subscription_id = subscription.id
                      AND (balance.max_uses IS NULL OR balance.used_count < balance.max_uses)
                  )
            `;
        });
    }
}

interface CustomerPlanRow {
    id: string;
    userId: string;
    planId: string;
    salonId: string;
    status: string;
    usageData: Record<string, number> | null;
    purchaseDate: Date;
    expiryDate: Date;
}
