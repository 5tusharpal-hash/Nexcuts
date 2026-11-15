import { Pool } from 'pg';
import { ApiError } from '../../shared/errors/ApiError.js';
import type { PublicReview, ReviewSubmission } from './reviews.types.js';

export class ReviewsRepository {
    constructor(private pool: Pool) {}

    async submitReview(submission: ReviewSubmission): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            if (!Number.isInteger(submission.salonRating) || submission.salonRating < 1 || submission.salonRating > 5) {
                throw new ApiError(400, 'Salon rating must be a whole number from 1 to 5');
            }
            for (const review of submission.stylistRatings) {
                if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) {
                    throw new ApiError(400, 'Staff ratings must be whole numbers from 1 to 5');
                }
            }

            const bill = await client.query<{
                salon_id: string;
                status: string;
            }>(
                `SELECT bill.salon_id, bill.status
                 FROM pos_bills AS bill
                 JOIN pos_billing_sessions AS session
                   ON session.id = bill.session_id
                  AND session.salon_id = bill.salon_id
                 WHERE bill.id = $1
                   AND session.customer_account_id = $2
                   AND bill.salon_id = $3
                 FOR UPDATE OF bill`,
                [submission.billId, submission.customerId, submission.salonId]
            );
            const billRow = bill.rows[0];
            if (!billRow || billRow.status !== 'CLOSED') {
                throw new ApiError(404, 'A completed bill for this customer was not found');
            }

            await client.query(
                `INSERT INTO customer_salon_reviews
                    (salon_id, bill_id, customer_account_id, rating, comment, is_public)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    submission.salonId,
                    submission.billId,
                    submission.customerId,
                    submission.salonRating,
                    submission.salonComment,
                    submission.salonRating >= 4,
                ]
            );

            const staffIds = submission.stylistRatings.map(({ stylistId }) => stylistId);
            if (new Set(staffIds).size !== staffIds.length) {
                throw new ApiError(400, 'A staff member can be rated only once per bill');
            }
            if (staffIds.length) {
                const assignedStaff = await client.query<{ staff_membership_id: string }>(
                    `SELECT DISTINCT item.staff_membership_id
                     FROM pos_bill_items AS item
                     JOIN salon_membership_locations AS location
                       ON location.membership_id = item.staff_membership_id
                      AND location.salon_id = item.salon_id
                     WHERE item.bill_id = $1
                       AND item.salon_id = $2
                       AND item.item_type = 'SERVICE'
                       AND item.staff_membership_id = ANY($3::uuid[])`,
                    [submission.billId, submission.salonId, staffIds]
                );
                if (assignedStaff.rowCount !== staffIds.length) {
                    throw new ApiError(400, 'Only staff assigned to a billed service can be rated');
                }
            }

            for (const sReview of submission.stylistRatings) {
                await client.query(
                    `INSERT INTO customer_staff_reviews
                        (salon_id, bill_id, customer_account_id, staff_membership_id, rating, comment)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        submission.salonId,
                        submission.billId,
                        submission.customerId,
                        sReview.stylistId,
                        sReview.rating,
                        sReview.comment,
                    ]
                );
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            if (
                typeof e === 'object' &&
                e !== null &&
                'code' in e &&
                e.code === '23505'
            ) {
                throw new ApiError(409, 'A review has already been submitted for this bill');
            }
            throw e;
        } finally {
            client.release();
        }
    }

    async getStylistAverageRating(stylistId: string, salonId: string): Promise<number> {
        const res = await this.pool.query(
            `SELECT COALESCE(AVG(rating), 0) AS avg_rating
             FROM customer_staff_reviews
             WHERE staff_membership_id = $1 AND salon_id = $2`,
            [stylistId, salonId]
        );
        return Number(res.rows[0].avg_rating);
    }

    async listPublicSalonReviews(
        salonId: string,
        limit: number,
        offset: number
    ): Promise<{ items: PublicReview[]; total: number }> {
        const [reviews, count] = await Promise.all([
            this.pool.query<PublicReview>(
                `SELECT id, rating, comment, created_at AS "createdAt"
                 FROM customer_salon_reviews
                 WHERE salon_id = $1 AND is_public = TRUE
                 ORDER BY created_at DESC, id DESC
                 LIMIT $2 OFFSET $3`,
                [salonId, limit, offset]
            ),
            this.pool.query<{ total: string }>(
                `SELECT COUNT(*)::text AS total
                 FROM customer_salon_reviews
                 WHERE salon_id = $1 AND is_public = TRUE`,
                [salonId]
            ),
        ]);
        return { items: reviews.rows, total: Number(count.rows[0].total) };
    }
}
