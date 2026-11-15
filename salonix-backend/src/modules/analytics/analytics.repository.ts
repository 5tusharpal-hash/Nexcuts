import { Pool } from 'pg';
import {
    ChurnAlert,
    RevenueStats,
    OperationalStats,
    CustomerInsights,
    StaffPerformance,
} from './analytics.types';

export class AnalyticsRepository {
    constructor(private pool: Pool) {}

    async getRevenueStats(branchId: string, startDate: Date, endDate: Date): Promise<RevenueStats> {
        const periodLength = endDate.getTime() - startDate.getTime();
        const previousStart = new Date(startDate.getTime() - periodLength);
        const res = await this.pool.query<{
            totalRevenue: string;
            serviceRevenue: string;
            productRevenue: string;
            billCount: number;
            previousRevenue: string;
        }>(
            `WITH current_bills AS (
                SELECT id, total_amount
                FROM pos_bills
                WHERE salon_id = $1
                  AND status = 'CLOSED'
                  AND closed_at BETWEEN $2 AND $3
            ),
            previous_bills AS (
                SELECT total_amount
                FROM pos_bills
                WHERE salon_id = $1
                  AND status = 'CLOSED'
                  AND closed_at >= $4
                  AND closed_at < $2
            )
            SELECT
                COALESCE((SELECT SUM(total_amount) FROM current_bills), 0)::text AS "totalRevenue",
                COALESCE(SUM(item.subtotal) FILTER (WHERE item.item_type = 'SERVICE'), 0)::text AS "serviceRevenue",
                COALESCE(SUM(item.subtotal) FILTER (WHERE item.item_type = 'PRODUCT'), 0)::text AS "productRevenue",
                (SELECT COUNT(*)::int FROM current_bills) AS "billCount",
                COALESCE((SELECT SUM(total_amount) FROM previous_bills), 0)::text AS "previousRevenue"
            FROM current_bills AS bill
            LEFT JOIN pos_bill_items AS item
              ON item.bill_id = bill.id
             AND item.salon_id = $1`,
            [branchId, startDate, endDate, previousStart]
        );
        const row = res.rows[0];
        const totalRevenue = Number(row.totalRevenue);
        const previousRevenue = Number(row.previousRevenue);

        return {
            totalRevenue,
            serviceRevenue: Number(row.serviceRevenue),
            productRevenue: Number(row.productRevenue),
            averageTicketValue: row.billCount ? totalRevenue / row.billCount : 0,
            growthPercentage: previousRevenue
                ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
                : 0,
        };
    }

    async getOperationalStats(branchId: string, startDate: Date, endDate: Date): Promise<OperationalStats> {
        const utilization = await this.pool.query<{ utilizationRate: string | null }>(
            `WITH shifts AS (
                SELECT
                    shift.id,
                    shift.membership_id,
                    GREATEST(shift.clocked_in_at, $2::timestamptz) AS starts_at,
                    LEAST(
                        COALESCE(shift.clocked_out_at, LEAST($3::timestamptz, CURRENT_TIMESTAMP)),
                        $3::timestamptz
                    ) AS ends_at
                FROM salon_employee_shifts AS shift
                WHERE shift.salon_id = $1
                  AND shift.clocked_in_at < $3
                  AND COALESCE(shift.clocked_out_at, CURRENT_TIMESTAMP) > $2
            ),
            attendance AS (
                SELECT
                    shift.id,
                    shift.membership_id,
                    shift.starts_at,
                    shift.ends_at,
                    GREATEST(
                        0,
                        EXTRACT(EPOCH FROM (shift.ends_at - shift.starts_at)) / 60
                        - COALESCE((
                            SELECT SUM(
                                EXTRACT(EPOCH FROM (
                                    LEAST(COALESCE(lunch.ended_at, shift.ends_at), shift.ends_at)
                                    - GREATEST(lunch.started_at, shift.starts_at)
                                )) / 60
                            )
                            FROM salon_employee_lunch_breaks AS lunch
                            WHERE lunch.shift_id = shift.id
                              AND lunch.started_at < shift.ends_at
                              AND COALESCE(lunch.ended_at, CURRENT_TIMESTAMP) > shift.starts_at
                        ), 0)
                    ) AS attendance_minutes
                FROM shifts AS shift
                WHERE shift.ends_at > shift.starts_at
            ),
            work_ranges AS (
                SELECT
                    attendance.membership_id,
                    attendance.id AS shift_id,
                    tstzrange(
                        GREATEST(work.started_at, attendance.starts_at),
                        LEAST(COALESCE(work.ended_at, CURRENT_TIMESTAMP), attendance.ends_at),
                        '[)'
                    ) AS work_range
                FROM attendance
                JOIN salon_employee_service_work AS work
                  ON work.salon_id = $1
                 AND work.membership_id = attendance.membership_id
                 AND work.started_at < attendance.ends_at
                 AND COALESCE(work.ended_at, CURRENT_TIMESTAMP) > attendance.starts_at
            ),
            unique_work AS (
                SELECT
                    membership_id,
                    shift_id,
                    range_agg(work_range) AS work_ranges
                FROM work_ranges
                WHERE NOT isempty(work_range)
                GROUP BY membership_id, shift_id
            ),
            attendance_totals AS (
                SELECT COALESCE(SUM(attendance_minutes), 0) AS attendance_minutes
                FROM attendance
            ),
            active_totals AS (
                SELECT COALESCE(SUM(
                    EXTRACT(EPOCH FROM (upper(piece.work_range) - lower(piece.work_range))) / 60
                ), 0) AS active_minutes
                FROM unique_work
                LEFT JOIN LATERAL unnest(unique_work.work_ranges)
                    AS piece(work_range) ON TRUE
            )
            SELECT CASE WHEN attendance_minutes > 0
                THEN LEAST(100, active_minutes * 100 / attendance_minutes)
                ELSE 0
            END::text AS "utilizationRate"
            FROM attendance_totals
            CROSS JOIN active_totals`,
            [branchId, startDate, endDate]
        );

        return {
            stylistUtilizationRate: Number(utilization.rows[0]?.utilizationRate ?? 0),
        };
    }

    async getCustomerInsights(branchId: string): Promise<CustomerInsights> {
        const [insights, topCustomers] = await Promise.all([
            this.pool.query<{
                retentionRate: string | null;
                vipCustomerCount: number;
                churnRate: string | null;
            }>(
                `WITH visits AS (
                    SELECT
                        session.customer_account_id,
                        bill.closed_at,
                        LAG(bill.closed_at) OVER (
                            PARTITION BY session.customer_account_id
                            ORDER BY bill.closed_at
                        ) AS previous_visit
                    FROM pos_bills AS bill
                    JOIN pos_billing_sessions AS session
                      ON session.id = bill.session_id
                     AND session.salon_id = bill.salon_id
                    WHERE bill.salon_id = $1
                      AND bill.status = 'CLOSED'
                      AND bill.closed_at IS NOT NULL
                 ),
                 customer_visits AS (
                    SELECT
                        customer_account_id,
                        COUNT(*) AS visit_count,
                        MAX(closed_at) AS last_visit_at,
                        AVG(EXTRACT(EPOCH FROM (closed_at - previous_visit)) / 86400)
                            FILTER (WHERE previous_visit IS NOT NULL) AS usual_interval_days
                    FROM visits
                    GROUP BY customer_account_id
                 )
                 SELECT
                    COALESCE(
                        COUNT(*) FILTER (WHERE visit_count > 1) * 100.0 / NULLIF(COUNT(*), 0),
                        0
                    ) AS "retentionRate",
                    COUNT(*) FILTER (WHERE visit_count >= 5)::int AS "vipCustomerCount",
                    COALESCE(
                        COUNT(*) FILTER (
                            WHERE visit_count >= 3
                              AND usual_interval_days > 0
                              AND last_visit_at
                                  + (usual_interval_days::double precision * INTERVAL '1.5 days')
                                  < CURRENT_TIMESTAMP
                        ) * 100.0
                        / NULLIF(COUNT(*) FILTER (WHERE visit_count >= 3), 0),
                        0
                    ) AS "churnRate"
                 FROM customer_visits`,
                [branchId]
            ),
            this.pool.query<{ customerId: string; totalSpend: string }>(
                `SELECT
                    session.customer_account_id AS "customerId",
                    SUM(bill.total_amount)::text AS "totalSpend"
                 FROM pos_bills AS bill
                 JOIN pos_billing_sessions AS session
                   ON session.id = bill.session_id
                  AND session.salon_id = bill.salon_id
                 WHERE bill.salon_id = $1
                   AND bill.status = 'CLOSED'
                 GROUP BY session.customer_account_id
                 ORDER BY SUM(bill.total_amount) DESC
                 LIMIT 10`,
                [branchId]
            ),
        ]);

        return {
            retentionRate: Number(insights.rows[0].retentionRate ?? 0),
            vipCustomerCount: insights.rows[0].vipCustomerCount,
            churnRate: Number(insights.rows[0].churnRate ?? 0),
            topCustomers: topCustomers.rows.map((customer) => ({
                customerId: customer.customerId,
                totalSpend: Number(customer.totalSpend),
            })),
        };
    }

    async getStaffPerformance(branchId: string): Promise<StaffPerformance[]> {
        const res = await this.pool.query<{
            stylistId: string;
            totalRevenue: string;
            repeatCustomerCount: number;
            averageRating: string;
        }>(
            `WITH closed_items AS (
                SELECT
                    item.staff_membership_id,
                    item.subtotal,
                    bill.id AS bill_id,
                    session.customer_account_id
                FROM pos_bill_items AS item
                JOIN pos_bills AS bill
                  ON bill.id = item.bill_id
                 AND bill.salon_id = item.salon_id
                JOIN pos_billing_sessions AS session
                  ON session.id = bill.session_id
                 AND session.salon_id = bill.salon_id
                WHERE item.salon_id = $1
                  AND item.staff_membership_id IS NOT NULL
                  AND bill.status = 'CLOSED'
             ),
             staff_revenue AS (
                SELECT staff_membership_id, SUM(subtotal) AS total_revenue
                FROM closed_items
                GROUP BY staff_membership_id
             ),
             staff_visits AS (
                SELECT
                    item.staff_membership_id,
                    item.customer_account_id,
                    COUNT(DISTINCT item.bill_id) AS visit_count
                FROM closed_items AS item
                GROUP BY item.staff_membership_id, item.customer_account_id
             ),
             repeat_customers AS (
                SELECT staff_membership_id, COUNT(*)::int AS repeat_count
                FROM staff_visits
                WHERE visit_count > 1
                GROUP BY staff_membership_id
             ),
             staff_ratings AS (
                SELECT staff_membership_id, AVG(rating) AS average_rating
                FROM customer_staff_reviews
                WHERE salon_id = $1
                GROUP BY staff_membership_id
             )
             SELECT
                revenue.staff_membership_id AS "stylistId",
                revenue.total_revenue::text AS "totalRevenue",
                COALESCE(repeat_customers.repeat_count, 0) AS "repeatCustomerCount",
                COALESCE(staff_ratings.average_rating, 0)::text AS "averageRating"
             FROM staff_revenue AS revenue
             LEFT JOIN repeat_customers
               ON repeat_customers.staff_membership_id = revenue.staff_membership_id
             LEFT JOIN staff_ratings
               ON staff_ratings.staff_membership_id = revenue.staff_membership_id
             ORDER BY revenue.total_revenue DESC`,
            [branchId]
        );

        return res.rows.map((row) => ({
            stylistId: row.stylistId,
            totalRevenue: Number(row.totalRevenue),
            repeatCustomerCount: row.repeatCustomerCount,
            efficiencyScore: 0,
            averageRating: Number(row.averageRating),
        }));
    }

    async getChurnAlerts(branchId: string, limit: number, offset: number): Promise<ChurnAlert[]> {
        const result = await this.pool.query<{
            customerId: string;
            lastVisitAt: Date;
            usualVisitIntervalDays: string;
            overdueDays: string;
        }>(
            `WITH visits AS (
                SELECT
                    session.customer_account_id,
                    bill.closed_at,
                    LAG(bill.closed_at) OVER (
                        PARTITION BY session.customer_account_id
                        ORDER BY bill.closed_at
                    ) AS previous_visit
                FROM pos_bills AS bill
                JOIN pos_billing_sessions AS session
                  ON session.id = bill.session_id
                 AND session.salon_id = bill.salon_id
                WHERE bill.salon_id = $1
                  AND bill.status = 'CLOSED'
                  AND bill.closed_at IS NOT NULL
            ),
            visit_intervals AS (
                SELECT
                    customer_account_id,
                    MAX(closed_at) AS last_visit_at,
                    AVG(EXTRACT(EPOCH FROM (closed_at - previous_visit)) / 86400)
                        FILTER (WHERE previous_visit IS NOT NULL) AS usual_interval_days,
                    COUNT(*) AS visit_count
                FROM visits
                GROUP BY customer_account_id
            )
            SELECT
                customer_account_id AS "customerId",
                last_visit_at AS "lastVisitAt",
                usual_interval_days::text AS "usualVisitIntervalDays",
                GREATEST(
                    0,
                    FLOOR(
                        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_visit_at)) / 86400
                        - usual_interval_days * 1.5
                    )
                )::text AS "overdueDays"
            FROM visit_intervals
            WHERE visit_count >= 3
              AND usual_interval_days > 0
              AND last_visit_at
                  + (usual_interval_days::double precision * INTERVAL '1.5 days')
                  < CURRENT_TIMESTAMP
            ORDER BY last_visit_at ASC, customer_account_id ASC
            LIMIT $2 OFFSET $3`,
            [branchId, limit, offset]
        );
        return result.rows.map((row) => ({
            customerId: row.customerId,
            lastVisitAt: row.lastVisitAt,
            usualVisitIntervalDays: Number(row.usualVisitIntervalDays),
            overdueDays: Number(row.overdueDays),
        }));
    }
}
