import { Pool } from 'pg';
import { ApiError } from '../../shared/errors/ApiError.js';
import {
    SalonEnquiry,
    EnquiryResponse,
    CreateEnquiryRequest,
    EnquiryListQuery,
    EnquiryListResponse,
    EnquiryResponseList,
} from './enquiries.types';

export class EnquiriesRepository {
    constructor(private pool: Pool) {}

    async createEnquiry(data: CreateEnquiryRequest): Promise<SalonEnquiry> {
        const query = `
            INSERT INTO salon_enquiries
                (salon_id, customer_name, customer_phone, customer_email, service_interest, message)
            SELECT $1, $2, $3, $4, $5, $6
            FROM salons
            WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM salon_applications AS application
                  WHERE application.salon_id = salons.id
                    AND application.status = 'APPROVED'
              )
            RETURNING
                id,
                salon_id AS "branchId",
                customer_name AS "customerName",
                customer_phone AS "customerPhone",
                customer_email AS "customerEmail",
                service_interest AS "serviceInterest",
                message,
                status,
                created_at AS "createdAt",
                updated_at AS "updatedAt";
        `;
        const values = [data.branchId, data.customerName, data.customerPhone, data.customerEmail, data.serviceInterest, data.message];
        const res = await this.pool.query<SalonEnquiry>(query, values);
        if (!res.rows[0]) throw new ApiError(404, 'Active salon branch not found');
        return res.rows[0];
    }

    async updateStatus(
        branchId: string,
        enquiryId: string,
        status: Exclude<SalonEnquiry['status'], 'NEW' | 'CONVERTED'>
    ): Promise<void> {
        const result = await this.pool.query(
            `UPDATE salon_enquiries
             SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
               AND salon_id = $3
               AND status NOT IN ('CONVERTED', 'CLOSED')`,
            [status, enquiryId, branchId]
        );
        if (result.rowCount === 0) {
            const existing = await this.pool.query<{ status: string }>(
                'SELECT status FROM salon_enquiries WHERE id = $1 AND salon_id = $2',
                [enquiryId, branchId]
            );
            if (!existing.rowCount) throw new ApiError(404, 'Salon enquiry not found');
            throw new ApiError(409, 'Closed or converted enquiries cannot be changed');
        }
    }

    async addResponse(
        branchId: string,
        enquiryId: string,
        actorAccountId: string,
        note: string,
        isExternalReply: boolean
    ): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(
                `INSERT INTO salon_enquiry_responses
                    (enquiry_id, salon_id, staff_membership_id, note, is_external_reply)
                 SELECT enquiry.id, enquiry.salon_id, membership_location.membership_id, $4, $5
                 FROM salon_enquiries AS enquiry
                 JOIN salon_membership_locations AS membership_location
                   ON membership_location.salon_id = enquiry.salon_id
                 JOIN salon_memberships AS membership
                   ON membership.id = membership_location.membership_id
                  AND membership.account_id = $3
                  AND membership.status = 'ACTIVE'
                 WHERE enquiry.id = $1
                   AND enquiry.salon_id = $2`,
                [
                    enquiryId,
                    branchId,
                    actorAccountId,
                    note,
                    isExternalReply,
                ]
            );
            if (!result.rowCount) throw new ApiError(404, 'Salon enquiry or staff membership not found');
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getEnquiriesByBranch(branchId: string, query: EnquiryListQuery): Promise<EnquiryListResponse> {
        const [items, count] = await Promise.all([
            this.pool.query<SalonEnquiry>(
                `SELECT
            id,
            salon_id AS "branchId",
            customer_name AS "customerName",
            customer_phone AS "customerPhone",
            customer_email AS "customerEmail",
            service_interest AS "serviceInterest",
            message,
            status,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
            FROM salon_enquiries
            WHERE salon_id = $1
              AND ($2::varchar IS NULL OR status = $2)
            ORDER BY created_at DESC, id DESC
            LIMIT $3 OFFSET $4`,
                [branchId, query.status ?? null, query.limit, query.offset]
            ),
            this.pool.query<{ total: number }>(
                `SELECT COUNT(*)::int AS total
                 FROM salon_enquiries
                 WHERE salon_id = $1
                   AND ($2::varchar IS NULL OR status = $2)`,
                [branchId, query.status ?? null]
            ),
        ]);
        return { items: items.rows, total: count.rows[0].total };
    }

    async getResponses(
        branchId: string,
        enquiryId: string,
        limit: number,
        offset: number
    ): Promise<EnquiryResponseList> {
        const [items, count] = await Promise.all([
            this.pool.query<EnquiryResponse>(
                `SELECT
                id,
                enquiry_id AS "enquiryId",
                staff_membership_id AS "staffId",
                note,
                is_external_reply AS "isExternalReply",
                created_at AS "createdAt"
             FROM salon_enquiry_responses
             WHERE salon_id = $1 AND enquiry_id = $2
             ORDER BY created_at ASC, id ASC
             LIMIT $3 OFFSET $4`,
                [branchId, enquiryId, limit, offset]
            ),
            this.pool.query<{ total: number }>(
                `SELECT COUNT(*)::int AS total
                 FROM salon_enquiry_responses
                 WHERE salon_id = $1 AND enquiry_id = $2`,
                [branchId, enquiryId]
            ),
        ]);
        return { items: items.rows, total: count.rows[0].total };
    }

    async enquiryExists(branchId: string, enquiryId: string): Promise<boolean> {
        const result = await this.pool.query(
            'SELECT 1 FROM salon_enquiries WHERE salon_id = $1 AND id = $2',
            [branchId, enquiryId]
        );
        return result.rowCount !== 0;
    }
}
