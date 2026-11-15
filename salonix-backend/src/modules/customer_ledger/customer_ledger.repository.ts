import { prisma } from '../../bootstrap/db.connect';
import { LedgerEntry } from './customer_ledger.types';

export class CustomerLedgerRepository {
    async getUnifiedTimeline(userId: string, limit: number, offset: number): Promise<LedgerEntry[]> {
        const result = await prisma.$queryRaw<LedgerRow[]>`
            SELECT
                payment.id,
                payment.paid_at AS date,
                'PAYMENT'::text AS type,
                CASE
                    WHEN session.booking_group_id IS NOT NULL THEN 'GROUP_BOOKING'
                    WHEN session.booking_id IS NOT NULL THEN 'APPOINTMENT'
                    ELSE 'WALK_IN'
                END::text AS category,
                'Payment for salon services'::text AS description,
                payment.amount::double precision AS amount,
                CASE payment.payment_mode
                    WHEN 'CASH' THEN 'CASH'
                    WHEN 'POINTS' THEN 'POINTS'
                    WHEN 'PLAN' THEN 'PACKAGE'
                    WHEN 'CREDIT' THEN 'CREDIT'
                    ELSE 'ONLINE'
                END::text AS "paymentSource",
                NULL::uuid AS "billId",
                NULL::uuid AS "bookingId",
                'COMPLETED'::text AS status
            FROM pos_payments AS payment
            JOIN pos_billing_sessions AS session
              ON session.id = payment.session_id
             AND session.salon_id = payment.salon_id
            WHERE session.customer_account_id = ${userId}
              AND payment.status = 'SUCCESS'

            UNION ALL

            SELECT
                ledger.id,
                ledger.created_at AS date,
                'LOYALTY'::text AS type,
                'REWARD'::text AS category,
                CASE ledger.entry_type
                    WHEN 'EARNED' THEN 'Points earned'
                    WHEN 'EXPIRED' THEN 'Points expired'
                    WHEN 'REVERSAL' THEN 'Points reversed'
                    ELSE 'Points redeemed'
                END::text AS description,
                ledger.amount::double precision AS amount,
                'POINTS'::text AS "paymentSource",
                NULL::uuid AS "billId",
                NULL::uuid AS "bookingId",
                'COMPLETED'::text AS status
            FROM customer_loyalty_ledger AS ledger
            WHERE ledger.customer_account_id = ${userId}

            UNION ALL

            SELECT
                item.id,
                bill.closed_at AS date,
                'SERVICE'::text AS type,
                CASE
                    WHEN session.booking_group_id IS NOT NULL THEN 'GROUP_BOOKING'
                    WHEN session.booking_id IS NOT NULL THEN 'APPOINTMENT'
                    ELSE 'WALK_IN'
                END::text AS category,
                COALESCE(service.name, 'Salon service')::text AS description,
                item.subtotal::double precision AS amount,
                NULL::text AS "paymentSource",
                bill.id AS "billId",
                session.booking_id AS "bookingId",
                'COMPLETED'::text AS status
            FROM pos_bill_items AS item
            JOIN pos_bills AS bill
              ON bill.id = item.bill_id
             AND bill.salon_id = item.salon_id
            JOIN pos_billing_sessions AS session
              ON session.id = bill.session_id
             AND session.salon_id = bill.salon_id
            LEFT JOIN salon_services AS service
              ON service.id = item.service_id
             AND service.salon_id = item.salon_id
            WHERE session.customer_account_id = ${userId}
              AND bill.status = 'CLOSED'
              AND item.item_type = 'SERVICE'

            UNION ALL

            SELECT
                refund.id,
                refund.completed_at AS date,
                'REFUND'::text AS type,
                CASE
                    WHEN session.booking_group_id IS NOT NULL THEN 'GROUP_BOOKING'
                    WHEN session.booking_id IS NOT NULL THEN 'APPOINTMENT'
                    ELSE 'WALK_IN'
                END::text AS category,
                ('Refund: ' || refund.reason)::text AS description,
                -refund.amount::double precision AS amount,
                CASE
                    WHEN payment.payment_mode IS NULL THEN NULL
                    WHEN payment.payment_mode = 'CASH' THEN 'CASH'
                    WHEN payment.payment_mode = 'POINTS' THEN 'POINTS'
                    WHEN payment.payment_mode = 'PLAN' THEN 'PACKAGE'
                    WHEN payment.payment_mode = 'CREDIT' THEN 'CREDIT'
                    ELSE 'ONLINE'
                END::text AS "paymentSource",
                bill.id AS "billId",
                session.booking_id AS "bookingId",
                'COMPLETED'::text AS status
            FROM pos_refunds AS refund
            JOIN pos_bills AS bill
              ON bill.id = refund.bill_id
             AND bill.salon_id = refund.salon_id
            JOIN pos_billing_sessions AS session
              ON session.id = bill.session_id
             AND session.salon_id = bill.salon_id
            LEFT JOIN pos_payments AS payment
              ON payment.id = refund.payment_id
             AND payment.salon_id = refund.salon_id
            WHERE session.customer_account_id = ${userId}
              AND refund.status = 'COMPLETED'
              AND refund.completed_at IS NOT NULL

            ORDER BY date DESC, id DESC
            LIMIT ${limit}
            OFFSET ${offset};
        `;

        return result.map((row) => ({
            ...row,
            type: row.type as LedgerEntry['type'],
            category: row.category as LedgerEntry['category'],
            paymentSource: row.paymentSource ?? undefined,
            status: row.status as LedgerEntry['status'],
            billId: row.billId ?? undefined,
            bookingId: row.bookingId ?? undefined,
        }));
    }

    async getTimelineSummary(userId: string) {
        const [summary] = await prisma.$queryRaw<Array<{
            totalSpent: number;
            totalPointsEarned: number;
            totalServicesTaken: number;
        }>>`
            SELECT
                (COALESCE((
                    SELECT SUM(payment.amount)
                    FROM pos_payments AS payment
                    JOIN pos_billing_sessions AS session
                      ON session.id = payment.session_id
                     AND session.salon_id = payment.salon_id
                    WHERE session.customer_account_id = ${userId}
                      AND payment.status = 'SUCCESS'
                ), 0) - COALESCE((
                    SELECT SUM(refund.amount)
                    FROM pos_refunds AS refund
                    JOIN pos_bills AS bill
                      ON bill.id = refund.bill_id
                     AND bill.salon_id = refund.salon_id
                    JOIN pos_billing_sessions AS session
                      ON session.id = bill.session_id
                     AND session.salon_id = bill.salon_id
                    WHERE session.customer_account_id = ${userId}
                      AND refund.status = 'COMPLETED'
                ), 0))::double precision AS "totalSpent",
                COALESCE((
                    SELECT SUM(ledger.amount)
                    FROM customer_loyalty_ledger AS ledger
                    WHERE ledger.customer_account_id = ${userId}
                      AND ledger.entry_type = 'EARNED'
                ), 0)::double precision AS "totalPointsEarned",
                (
                    SELECT COUNT(*)::int
                    FROM pos_bill_items AS item
                    JOIN pos_bills AS bill
                      ON bill.id = item.bill_id
                     AND bill.salon_id = item.salon_id
                    JOIN pos_billing_sessions AS session
                      ON session.id = bill.session_id
                     AND session.salon_id = bill.salon_id
                    WHERE session.customer_account_id = ${userId}
                      AND bill.status = 'CLOSED'
                      AND item.item_type = 'SERVICE'
                ) AS "totalServicesTaken";
        `;
        return summary;
    }

    async getTimelineCount(userId: string): Promise<number> {
        const [result] = await prisma.$queryRaw<Array<{ total: number }>>`
            SELECT (
                SELECT COUNT(*)
                FROM pos_payments AS payment
                JOIN pos_billing_sessions AS session
                  ON session.id = payment.session_id
                 AND session.salon_id = payment.salon_id
                WHERE session.customer_account_id = ${userId}
                  AND payment.status = 'SUCCESS'
            ) + (
                SELECT COUNT(*)
                FROM pos_refunds AS refund
                JOIN pos_bills AS bill
                  ON bill.id = refund.bill_id
                 AND bill.salon_id = refund.salon_id
                JOIN pos_billing_sessions AS session
                  ON session.id = bill.session_id
                 AND session.salon_id = bill.salon_id
                WHERE session.customer_account_id = ${userId}
                  AND refund.status = 'COMPLETED'
            ) + (
                SELECT COUNT(*)
                FROM customer_loyalty_ledger AS ledger
                WHERE ledger.customer_account_id = ${userId}
            ) + (
                SELECT COUNT(*)
                FROM pos_bill_items AS item
                JOIN pos_bills AS bill
                  ON bill.id = item.bill_id
                 AND bill.salon_id = item.salon_id
                JOIN pos_billing_sessions AS session
                  ON session.id = bill.session_id
                 AND session.salon_id = bill.salon_id
                WHERE session.customer_account_id = ${userId}
                  AND bill.status = 'CLOSED'
                  AND item.item_type = 'SERVICE'
            ) AS total;
        `;
        return result.total;
    }

    async getBillDetails(billId: string, userId: string) {
        const [ownedBill] = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT bill.id
            FROM pos_bills AS bill
            JOIN pos_billing_sessions AS session
              ON session.id = bill.session_id
             AND session.salon_id = bill.salon_id
            WHERE bill.id = ${billId}
              AND session.customer_account_id = ${userId}
            LIMIT 1;
        `;
        if (!ownedBill) return null;
        const bill = await prisma.posBill.findUnique({ where: { id: ownedBill.id } });
        if (!bill) return null;
        const items = await prisma.posBillItem.findMany({
            where: { billId, salonId: bill.salonId },
            orderBy: { createdAt: 'asc' },
        });
        return { ...bill, items };
    }
}

interface LedgerRow {
    id: string;
    date: Date;
    type: string;
    category: string;
    description: string;
    amount: number;
    paymentSource: LedgerEntry['paymentSource'] | null;
    billId: string | null;
    bookingId: string | null;
    status: string;
}
