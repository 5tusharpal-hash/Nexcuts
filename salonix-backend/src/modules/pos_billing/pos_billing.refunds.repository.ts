import { prisma } from '../../bootstrap/db.connect';
import { CreditNote, RefundRequest, UserCredit } from './pos_billing.refunds.types';

export class RefundRepository {
    async createCreditNote(data: RefundRequest): Promise<CreditNote> {
        if (!Number.isFinite(data.amount) || data.amount <= 0) {
            throw new Error('Refund amount must be a positive finite number');
        }

        return prisma.$transaction(async (tx) => {
            const bills = await tx.$queryRaw<Array<{
                id: string;
                salonId: string;
                totalAmount: string;
                sessionId: string;
            }>>`
                SELECT
                    id,
                    salon_id AS "salonId",
                    total_amount::text AS "totalAmount",
                    session_id AS "sessionId"
                FROM pos_bills
                WHERE id = ${data.billId}
                FOR UPDATE
            `;
            const bill = bills[0];
            if (!bill) throw new Error('Bill not found');

            const session = await tx.posBillingSession.findUnique({
                where: { id: bill.sessionId },
                select: { customerAccountId: true, status: true },
            });
            if (!session) throw new Error('Billing session not found');

            const successfulPayments = await tx.posPayment.aggregate({
                where: {
                    sessionId: bill.sessionId,
                    salonId: bill.salonId,
                    status: 'SUCCESS',
                },
                _sum: { amount: true },
            });
            const paidAmount = Number(successfulPayments._sum.amount ?? 0)
                || (session.status === 'PAID' ? Number(bill.totalAmount) : 0);
            const existingNotes = await tx.posCreditNote.aggregate({
                where: {
                    billId: bill.id,
                    salonId: bill.salonId,
                    status: { in: ['ISSUED', 'REDEEMED'] },
                },
                _sum: { amount: true },
            });
            const alreadyCredited = Number(existingNotes._sum.amount ?? 0);
            if (alreadyCredited + data.amount > paidAmount) {
                throw new Error('Refund amount exceeds the amount paid and still refundable');
            }

            const creditNote = await tx.posCreditNote.create({
                data: {
                    billId: bill.id,
                    salonId: bill.salonId,
                    customerAccountId: session.customerAccountId,
                    amount: data.amount,
                    reason: data.reason,
                    status: 'ISSUED',
                },
            });
            return {
                id: creditNote.id,
                billId: creditNote.billId,
                userId: creditNote.customerAccountId,
                salonId: creditNote.salonId,
                amount: Number(creditNote.amount),
                reason: creditNote.reason as CreditNote['reason'],
                status: creditNote.status as CreditNote['status'],
                expiryDate: creditNote.expiresAt ?? undefined,
                createdAt: creditNote.createdAt,
            };
        });
    }

    async updateUserCredit(userId: string, salonId: string, amount: number): Promise<UserCredit> {
        if (!Number.isFinite(amount) || amount === 0) {
            throw new Error('Credit change must be a non-zero finite number');
        }
        if (amount > 0) {
            const credit = await prisma.customerSalonCredit.upsert({
                where: {
                    customerAccountId_salonId: { customerAccountId: userId, salonId },
                },
                create: { customerAccountId: userId, salonId, balance: amount },
                update: { balance: { increment: amount } },
            });
            return {
                userId: credit.customerAccountId,
                salonId: credit.salonId,
                balance: Number(credit.balance),
                updatedAt: credit.updatedAt,
            };
        }

        const updated = await prisma.customerSalonCredit.updateMany({
            where: {
                customerAccountId: userId,
                salonId,
                balance: { gte: -amount },
            },
            data: { balance: { decrement: -amount } },
        });
        if (updated.count === 0) throw new Error('Insufficient credit balance');
        const credit = await prisma.customerSalonCredit.findUniqueOrThrow({
            where: {
                customerAccountId_salonId: { customerAccountId: userId, salonId },
            },
        });
        return {
            userId: credit.customerAccountId,
            salonId: credit.salonId,
            balance: Number(credit.balance),
            updatedAt: credit.updatedAt,
        };
    }

    async getUserBalance(userId: string, salonId: string): Promise<number> {
        const credit = await prisma.customerSalonCredit.findUnique({
            where: { customerAccountId_salonId: { customerAccountId: userId, salonId } },
            select: { balance: true },
        });
        return Number(credit?.balance ?? 0);
    }
}
