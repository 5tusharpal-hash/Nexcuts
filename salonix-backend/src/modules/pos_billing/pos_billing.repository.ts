import { prisma } from '../../bootstrap/db.connect';
import { randomUUID } from 'node:crypto';
import { BillItem, BillRequest, BillResponse } from './pos_billing.types';

export class PosBillingRepository {
    async createBill(
        request: BillRequest,
        items: BillItem[],
        userId: string,
        salonId: string
    ): Promise<BillResponse> {
        if (items.length === 0) throw new Error('A bill must contain at least one item');
        if (!Number.isFinite(request.amountPaid) || request.amountPaid < 0) {
            throw new Error('Payment amount must be a non-negative finite number');
        }

        return prisma.$transaction(async (tx) => {
            const booking = request.bookingId
                ? await tx.customerBooking.findFirst({
                    where: {
                        id: request.bookingId,
                        salonId,
                        customerAccountId: userId,
                    },
                    select: { groupId: true },
                })
                : null;
            if (request.bookingId && !booking) {
                throw new Error('Booking does not belong to this customer and salon');
            }

            if (request.paymentMethod === 'COMBO') {
                if (!request.comboPurchaseId) {
                    throw new Error('Combo purchase is required for combo checkout');
                }
                const purchase = await tx.customerComboPurchase.findFirst({
                    where: {
                        id: request.comboPurchaseId,
                        salonId,
                        customerAccountId: userId,
                        paymentStatus: 'PAID',
                        status: 'ACTIVE',
                        expiresAt: { gt: new Date() },
                    },
                    select: { id: true, comboId: true },
                });
                if (!purchase) {
                    throw new Error('Active paid combo purchase was not found');
                }
                const allowedServices = await tx.salonComboService.findMany({
                    where: { comboId: purchase.comboId, salonId },
                    select: { serviceId: true },
                });
                const serviceIds = new Set(
                    items.map((item) => item.serviceId).filter((id): id is string => Boolean(id))
                );
                const allowedIds = new Set(allowedServices.map((item) => item.serviceId));
                if (
                    serviceIds.size === 0
                    || allowedIds.size !== serviceIds.size
                    || [...serviceIds].some((id) => !allowedIds.has(id))
                ) {
                    throw new Error('Combo checkout must include exactly the services covered by the combo');
                }
                const claimed = await tx.customerComboPurchase.updateMany({
                    where: { id: purchase.id, status: 'ACTIVE' },
                    data: { status: 'USED' },
                });
                if (claimed.count !== 1) {
                    throw new Error('Combo purchase was already redeemed');
                }
            }

            const pricedItems: PricedBillItem[] = [];
            for (const item of items) {
                if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
                    throw new Error('Bill item quantity must be a positive finite number');
                }
                if (Boolean(item.serviceId) === Boolean(item.productId)) {
                    throw new Error('Each bill item must reference exactly one service or product');
                }

                const itemType = item.serviceId ? 'SERVICE' : 'PRODUCT';
                const taxRates = await tx.salonTaxRate.findMany({
                    where: { salonId, itemType, isActive: true },
                    select: { rate: true },
                });
                const taxRate = taxRates.reduce((sum, tax) => sum + Number(tax.rate), 0);
                if (taxRate > 100) throw new Error(`Combined ${itemType.toLowerCase()} tax exceeds 100%`);

                let unitPrice: number;
                if (item.serviceId) {
                    const service = await tx.salonService.findFirst({
                        where: {
                            id: item.serviceId,
                            salonId,
                            isActive: true,
                            deletedAt: null,
                        },
                        select: { basePrice: true },
                    });
                    if (!service) throw new Error('Active salon service not found');
                    unitPrice = Number(service.basePrice);
                } else {
                    const product = await tx.salonProduct.findFirst({
                        where: {
                            id: item.productId,
                            salonId,
                            isActive: true,
                            isSellable: true,
                            deletedAt: null,
                        },
                        select: { retailPrice: true },
                    });
                    if (product?.retailPrice == null) {
                        throw new Error('Sellable salon product not found or has no retail price');
                    }
                    unitPrice = Number(product.retailPrice);
                }

                const subtotal = this.roundCurrency(unitPrice * item.quantity);
                const taxAmount = this.roundCurrency(subtotal * taxRate / 100);
                pricedItems.push({
                    itemType,
                    serviceId: item.serviceId,
                    productId: item.productId,
                    staffMembershipId: item.staffMembershipId,
                    quantity: item.quantity,
                    unitPrice,
                    subtotal,
                    taxRate,
                    taxAmount,
                });
            }

            const subtotal = this.roundCurrency(
                pricedItems.reduce((sum, item) => sum + item.subtotal, 0)
            );
            const serviceTaxAmount = this.roundCurrency(
                pricedItems.filter((item) => item.itemType === 'SERVICE')
                    .reduce((sum, item) => sum + item.taxAmount, 0)
            );
            const productTaxAmount = this.roundCurrency(
                pricedItems.filter((item) => item.itemType === 'PRODUCT')
                    .reduce((sum, item) => sum + item.taxAmount, 0)
            );
            const totalAmount = this.roundCurrency(subtotal + serviceTaxAmount + productTaxAmount);
            if (
                ['PACKAGE', 'COMBO'].includes(request.paymentMethod)
                && (
                    pricedItems.some((item) => item.itemType !== 'SERVICE')
                    || request.amountPaid !== 0
                )
            ) {
                throw new Error(`${request.paymentMethod === 'PACKAGE' ? 'Package' : 'Combo'} checkout supports service-only bills with no additional payment`);
            }
            if (request.amountPaid > totalAmount) {
                throw new Error('Payment amount cannot exceed the bill total');
            }
            const paymentAmount = request.amountPaid;
            const sessionPaid = paymentAmount >= totalAmount || request.paymentMethod === 'PACKAGE';
            const session = await tx.posBillingSession.create({
                data: {
                    salonId,
                    customerAccountId: userId,
                    bookingId: request.bookingId,
                    bookingGroupId: booking?.groupId,
                    sessionTotal: totalAmount,
                    status: sessionPaid ? 'PAID' : paymentAmount > 0 ? 'PARTIAL' : 'OPEN',
                    closedAt: sessionPaid ? new Date() : null,
                },
            });

            const bill = await tx.posBill.create({
                data: {
                    sessionId: session.id,
                    salonId,
                    invoiceNumber: `SAL-${Date.now()}-${randomUUID()}`,
                    billType: this.billType(pricedItems),
                    subtotal,
                    serviceTaxAmount,
                    productTaxAmount,
                    totalAmount,
                    status: sessionPaid ? 'CLOSED' : 'OPEN',
                    closedAt: sessionPaid ? new Date() : null,
                },
            });

            await tx.posBillItem.createMany({
                data: pricedItems.map((item) => ({
                    billId: bill.id,
                    salonId,
                    itemType: item.itemType,
                    serviceId: item.serviceId,
                    productId: item.productId,
                    staffMembershipId: item.staffMembershipId,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    subtotal: item.subtotal,
                    taxRate: item.taxRate,
                    taxAmount: item.taxAmount,
                    isCoveredByPlan: request.paymentMethod === 'PACKAGE' || request.paymentMethod === 'COMBO',
                })),
            });

            for (const item of pricedItems) {
                if (item.itemType === 'PRODUCT' && item.productId) {
                    const stock = await tx.salonProduct.updateMany({
                        where: {
                            id: item.productId,
                            salonId,
                            isActive: true,
                            currentStock: { gte: item.quantity },
                        },
                        data: { currentStock: { decrement: item.quantity } },
                    });
                    if (stock.count === 0) {
                        throw new Error(`Insufficient inventory for product ${item.productId}`);
                    }
                    await tx.salonInventoryLedger.create({
                        data: {
                            salonId,
                            productId: item.productId,
                            quantityChange: -item.quantity,
                            reason: 'RETAIL_SALE',
                            referenceId: bill.id,
                        },
                    });
                    continue;
                }
                if (!item.serviceId) continue;

                if (request.paymentMethod === 'PACKAGE') {
                    if (!Number.isInteger(item.quantity)) {
                        throw new Error('Package-covered service quantity must be a whole number');
                    }
                    for (let use = 0; use < item.quantity; use += 1) {
                        const used = await tx.$queryRaw<Array<{ subscriptionId: string }>>`
                            WITH candidate AS (
                                SELECT subscription.id, balance.service_id
                                FROM customer_package_subscriptions AS subscription
                                JOIN customer_package_service_balances AS balance
                                  ON balance.subscription_id = subscription.id
                                 AND balance.salon_id = subscription.salon_id
                                WHERE subscription.customer_account_id = ${userId}
                                  AND subscription.salon_id = ${salonId}
                                  AND subscription.payment_status = 'PAID'
                                  AND subscription.status = 'ACTIVE'
                                  AND subscription.expires_at > CURRENT_TIMESTAMP
                                  AND balance.service_id = ${item.serviceId}
                                  AND (balance.max_uses IS NULL OR balance.used_count < balance.max_uses)
                                ORDER BY subscription.expires_at ASC
                                FOR UPDATE OF subscription, balance SKIP LOCKED
                                LIMIT 1
                            )
                            UPDATE customer_package_service_balances AS balance
                            SET used_count = balance.used_count + 1
                            FROM candidate
                            WHERE balance.subscription_id = candidate.id
                              AND balance.service_id = candidate.service_id
                            RETURNING balance.subscription_id AS "subscriptionId"
                        `;
                        if (!used[0]) {
                            throw new Error(`No available package usage remains for service ${item.serviceId}`);
                        }
                        await tx.$executeRaw`
                            UPDATE customer_package_subscriptions AS subscription
                            SET status = 'EXHAUSTED'
                            WHERE subscription.id = ${used[0].subscriptionId}
                              AND NOT EXISTS (
                                SELECT 1
                                FROM customer_package_service_balances AS balance
                                WHERE balance.subscription_id = subscription.id
                                  AND (
                                    balance.max_uses IS NULL
                                    OR balance.used_count < balance.max_uses
                                  )
                              )
                        `;
                    }
                }

                const consumables = await tx.salonServiceConsumable.findMany({
                    where: { salonId, serviceId: item.serviceId },
                    select: { productId: true, quantityRequired: true },
                });
                for (const consumable of consumables) {
                    const quantity = this.roundCurrency(
                        Number(consumable.quantityRequired) * item.quantity
                    );
                    const stock = await tx.salonProduct.updateMany({
                        where: {
                            id: consumable.productId,
                            salonId,
                            isActive: true,
                            currentStock: { gte: quantity },
                        },
                        data: { currentStock: { decrement: quantity } },
                    });
                    if (stock.count === 0) {
                        throw new Error(`Insufficient inventory for product ${consumable.productId}`);
                    }
                    await tx.salonInventoryLedger.create({
                        data: {
                            salonId,
                            productId: consumable.productId,
                            quantityChange: -quantity,
                            reason: 'SERVICE_USE',
                            referenceId: bill.id,
                        },
                    });
                }
            }

            if (request.paymentMethod === 'POINTS' && paymentAmount > 0) {
                const lockKey = `${userId}:${salonId}`;
                await tx.$queryRaw`
                    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
                `;
                const balance = await tx.customerLoyaltyLedger.aggregate({
                    where: {
                        customerAccountId: userId,
                        salonId,
                        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                    },
                    _sum: { amount: true },
                });
                if (Number(balance._sum.amount ?? 0) < paymentAmount) {
                    throw new Error('Insufficient points balance');
                }
                await tx.customerLoyaltyLedger.create({
                    data: {
                        customerAccountId: userId,
                        salonId,
                        amount: -paymentAmount,
                        transactionReference: bill.id,
                    },
                });
            }

            if (paymentAmount > 0) {
                await tx.posPayment.create({
                    data: {
                        sessionId: session.id,
                        salonId,
                        paymentMode: this.paymentMode(request.paymentMethod),
                        amount: paymentAmount,
                        status: 'SUCCESS',
                    },
                });
            }

            if (request.paymentMethod !== 'POINTS' && request.paymentMethod !== 'PACKAGE') {
                const loyaltyProgram = await tx.salonLoyaltyProgram.findUnique({
                    where: { salonId },
                });
                if (
                    loyaltyProgram?.isActive
                    && paymentAmount >= Number(loyaltyProgram.minimumSpend)
                ) {
                    const points = paymentAmount
                        * Number(loyaltyProgram.rewardPercentage) / 100
                        * Number(loyaltyProgram.pointConversionRate);
                    if (points > 0) {
                        const expiresAt = loyaltyProgram.pointsExpiryDays
                            ? new Date(Date.now() + loyaltyProgram.pointsExpiryDays * 86_400_000)
                            : undefined;
                        await tx.customerLoyaltyLedger.create({
                            data: {
                                customerAccountId: userId,
                                salonId,
                                amount: points,
                                transactionReference: bill.id,
                                expiresAt,
                            },
                        });
                    }
                }
            }

            return {
                id: bill.id,
                totalAmount,
                paymentStatus: sessionPaid
                    ? 'PAID'
                    : paymentAmount > 0 ? 'PARTIAL' : 'UNPAID',
                createdAt: bill.createdAt,
            };
        });
    }

    async updatePaymentStatus(billId: string, status: string): Promise<void> {
        const session = await prisma.posBill.findUnique({
            where: { id: billId },
            select: { sessionId: true },
        });
        if (!session) throw new Error('Bill not found');

        const normalizedStatus = status.toUpperCase();
        if (!['PAID', 'PARTIAL', 'UNPAID', 'CANCELLED'].includes(normalizedStatus)) {
            throw new Error(`Unsupported payment status: ${status}`);
        }
        const sessionStatus = normalizedStatus === 'PAID'
            ? 'PAID'
            : normalizedStatus === 'PARTIAL' ? 'PARTIAL'
                : normalizedStatus === 'CANCELLED' ? 'CANCELLED' : 'OPEN';
        await prisma.$transaction([
            prisma.posBillingSession.update({
                where: { id: session.sessionId },
                data: {
                    status: sessionStatus,
                    closedAt: sessionStatus === 'PAID' ? new Date() : null,
                },
            }),
            prisma.posBill.update({
                where: { id: billId },
                data: {
                    status: normalizedStatus === 'CANCELLED'
                        ? 'CANCELLED'
                        : normalizedStatus === 'PAID' ? 'CLOSED' : 'OPEN',
                    closedAt: normalizedStatus === 'PAID' ? new Date() : null,
                },
            }),
        ]);
    }

    async getBillWithDetails(billId: string) {
        const bill = await prisma.posBill.findUnique({ where: { id: billId } });
        if (!bill) return null;
        const items = await prisma.posBillItem.findMany({
            where: { billId, salonId: bill.salonId },
            orderBy: { createdAt: 'asc' },
        });
        return { ...bill, items };
    }

    private paymentMode(method: BillRequest['paymentMethod']): string {
        switch (method) {
            case 'CASH':
                return 'CASH';
            case 'POINTS':
                return 'POINTS';
            case 'PACKAGE':
            case 'COMBO':
                return 'PLAN';
            case 'ONLINE':
                return 'UPI';
        }
    }

    private billType(items: PricedBillItem[]): string {
        const hasServices = items.some((item) => item.itemType === 'SERVICE');
        const hasProducts = items.some((item) => item.itemType === 'PRODUCT');
        return hasServices && hasProducts ? 'COMBINED' : hasProducts ? 'PRODUCT' : 'SERVICE';
    }

    private roundCurrency(value: number): number {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }
}

interface PricedBillItem extends BillItem {
    itemType: 'SERVICE' | 'PRODUCT';
    unitPrice: number;
    subtotal: number;
    taxRate: number;
    taxAmount: number;
}
