import type { PoolClient, QueryResultRow } from 'pg';
import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
    CreateHolidayRequest,
    CreateLeaveLedgerEntryRequest,
    CreateLeaveRequest,
    CreateLeaveTypeRequest,
    CreateServiceWorkRequest,
    CreateTipRequest,
    CreateTipRefundRequest,
    CompleteTipRefundRequest,
    DateRangeQuery,
    ReviewLeaveRequest,
    ReviewTipRequest,
    ReviewTipRefundRequest,
} from './employee_management.types.js';

interface MembershipRow extends QueryResultRow {
    membershipId: string;
    organizationId: string;
}

export class EmployeeManagementRepository {
    async clockIn(salonId: string, accountId: string) {
        try {
            const result = await db.query(
                `INSERT INTO salon_employee_shifts (salon_id, membership_id)
                 SELECT location.salon_id, membership.id
                 FROM salon_memberships AS membership
                 JOIN salon_membership_locations AS location
                   ON location.membership_id = membership.id
                 JOIN salons AS salon ON salon.id = location.salon_id
                 JOIN salon_applications AS application ON application.salon_id = salon.id
                 WHERE location.salon_id = $1 AND membership.account_id = $2
                   AND membership.status = 'ACTIVE'
                   AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
                   AND application.status = 'APPROVED'
                 RETURNING id, clocked_in_at AS "clockedInAt"`,
                [salonId, accountId]
            );
            if (!result.rows[0]) throw new ApiError(403, 'Active salon staff membership is required');
            return result.rows[0];
        } catch (error) {
            if (isUniqueViolation(error)) throw new ApiError(409, 'An open shift already exists');
            throw error;
        }
    }

    async clockOut(salonId: string, accountId: string) {
        return this.withTransaction(async (client) => {
            const membership = await this.getMembership(client, salonId, accountId);
            const shift = await client.query(
                `SELECT id FROM salon_employee_shifts
                 WHERE salon_id = $1 AND membership_id = $2 AND clocked_out_at IS NULL
                 FOR UPDATE`,
                [salonId, membership.membershipId]
            );
            if (!shift.rows[0]) throw new ApiError(409, 'There is no open shift to clock out from');
            const openBreak = await client.query(
                `SELECT 1 FROM salon_employee_lunch_breaks AS lunch
                 JOIN salon_employee_shifts AS shift ON shift.id = lunch.shift_id
                 WHERE shift.salon_id = $1 AND shift.membership_id = $2
                   AND shift.clocked_out_at IS NULL AND lunch.ended_at IS NULL`,
                [salonId, membership.membershipId]
            );
            if (openBreak.rowCount) throw new ApiError(409, 'End the lunch break before clocking out');
            const activeWork = await client.query(
                `SELECT 1 FROM salon_employee_service_work
                 WHERE salon_id = $1 AND membership_id = $2 AND ended_at IS NULL`,
                [salonId, membership.membershipId]
            );
            if (activeWork.rowCount) throw new ApiError(409, 'End active service work before clocking out');
            const result = await client.query(
                `UPDATE salon_employee_shifts
                 SET clocked_out_at = CURRENT_TIMESTAMP
                 WHERE salon_id = $1 AND membership_id = $2 AND clocked_out_at IS NULL
                 RETURNING id, clocked_in_at AS "clockedInAt",
                           clocked_out_at AS "clockedOutAt"`,
                [salonId, membership.membershipId]
            );
            if (!result.rows[0]) throw new ApiError(409, 'There is no open shift to clock out from');
            return result.rows[0];
        });
    }

    async startLunch(salonId: string, accountId: string) {
        try {
            return await this.withTransaction(async (client) => {
                const membership = await this.getMembership(client, salonId, accountId);
                const shift = await client.query(
                    `SELECT id FROM salon_employee_shifts
                     WHERE salon_id = $1 AND membership_id = $2 AND clocked_out_at IS NULL
                     FOR UPDATE`,
                    [salonId, membership.membershipId]
                );
                if (!shift.rows[0]) throw new ApiError(409, 'Clock in before starting lunch');
                const work = await client.query(
                    `SELECT 1 FROM salon_employee_service_work
                     WHERE salon_id = $1 AND membership_id = $2 AND ended_at IS NULL`,
                    [salonId, membership.membershipId]
                );
                if (work.rowCount) throw new ApiError(409, 'End active service work before starting lunch');
                const result = await client.query(
                    `INSERT INTO salon_employee_lunch_breaks (shift_id)
                     VALUES ($1)
                     RETURNING id, started_at AS "startedAt"`,
                    [shift.rows[0].id]
                );
                return result.rows[0];
            });
        } catch (error) {
            if (isUniqueViolation(error)) throw new ApiError(409, 'A lunch break is already in progress');
            throw error;
        }
    }

    async endLunch(salonId: string, accountId: string) {
        const membership = await this.getMembership(db, salonId, accountId);
        const result = await db.query(
            `UPDATE salon_employee_lunch_breaks AS lunch
             SET ended_at = CURRENT_TIMESTAMP
             FROM salon_employee_shifts AS shift
             WHERE lunch.shift_id = shift.id AND shift.salon_id = $1
               AND shift.membership_id = $2 AND shift.clocked_out_at IS NULL
               AND lunch.ended_at IS NULL
             RETURNING lunch.id, lunch.started_at AS "startedAt",
                       lunch.ended_at AS "endedAt"`,
            [salonId, membership.membershipId]
        );
        if (!result.rows[0]) throw new ApiError(409, 'There is no active lunch break');
        return result.rows[0];
    }

    async listHolidays(salonId: string, query: DateRangeQuery) {
        const result = await db.query(
            `SELECT id, holiday_date AS date, name, is_paid AS "isPaid",
                    note, created_at AS "createdAt"
             FROM salon_employee_holidays
             WHERE salon_id = $1 AND holiday_date BETWEEN $2::date AND $3::date
             ORDER BY holiday_date, id
             LIMIT $4 OFFSET $5`,
            [salonId, query.from, query.to, query.limit, query.offset]
        );
        return result.rows;
    }

    async createHoliday(salonId: string, actorAccountId: string, input: CreateHolidayRequest) {
        try {
            const result = await db.query(
                `INSERT INTO salon_employee_holidays (
                    salon_id, holiday_date, name, is_paid, note, created_by_account_id
                 ) VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, holiday_date AS date, name, is_paid AS "isPaid",
                           note, created_at AS "createdAt"`,
                [salonId, input.date, input.name, input.isPaid, input.note ?? null, actorAccountId]
            );
            return result.rows[0];
        } catch (error) {
            if (isUniqueViolation(error)) throw new ApiError(409, 'A holiday is already configured for this date');
            throw error;
        }
    }

    async deleteHoliday(salonId: string, holidayId: string) {
        const result = await db.query(
            `DELETE FROM salon_employee_holidays WHERE id = $1 AND salon_id = $2`,
            [holidayId, salonId]
        );
        if (!result.rowCount) throw new ApiError(404, 'Holiday was not found');
    }

    async listLeaveTypes(salonId: string) {
        const result = await db.query(
            `SELECT id, name, is_paid AS "isPaid",
                    deducts_balance AS "deductsBalance",
                    is_emergency AS "isEmergency", is_active AS "isActive"
             FROM salon_employee_leave_types
             WHERE salon_id = $1
             ORDER BY name, id`,
            [salonId]
        );
        return result.rows;
    }

    async createLeaveType(salonId: string, input: CreateLeaveTypeRequest) {
        try {
            const result = await db.query(
                `INSERT INTO salon_employee_leave_types (
                    salon_id, name, is_paid, deducts_balance, is_emergency
                 ) VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, name, is_paid AS "isPaid",
                           deducts_balance AS "deductsBalance",
                           is_emergency AS "isEmergency", is_active AS "isActive"`,
                [salonId, input.name, input.isPaid, input.deductsBalance, input.isEmergency]
            );
            return result.rows[0];
        } catch (error) {
            if (isUniqueViolation(error)) throw new ApiError(409, 'A leave type with this name already exists');
            throw error;
        }
    }

    async createLeaveRequest(salonId: string, accountId: string, input: CreateLeaveRequest) {
        return this.withTransaction(async (client) => {
            const membership = await this.getMembership(client, salonId, accountId);
            await this.lockMembership(client, salonId, membership.membershipId);
            const type = await client.query(
                `SELECT id FROM salon_employee_leave_types
                 WHERE id = $1 AND salon_id = $2 AND is_active = TRUE`,
                [input.leaveTypeId, salonId]
            );
            if (!type.rowCount) throw new ApiError(404, 'Active leave type was not found');
            const overlap = await client.query(
                `SELECT 1 FROM salon_employee_leave_requests
                 WHERE salon_id = $1 AND membership_id = $2
                   AND status IN ('PENDING', 'APPROVED')
                   AND daterange(starts_on, ends_on, '[]') &&
                       daterange($3::date, $4::date, '[]')`,
                [salonId, membership.membershipId, input.startsOn, input.endsOn]
            );
            if (overlap.rowCount) {
                throw new ApiError(409, 'Leave dates overlap an existing pending or approved request');
            }
            const result = await client.query(
                `INSERT INTO salon_employee_leave_requests (
                    salon_id, membership_id, leave_type_id, starts_on, ends_on,
                    requested_days, reason
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id, leave_type_id AS "leaveTypeId",
                           starts_on AS "startsOn", ends_on AS "endsOn",
                           requested_days::float8 AS "requestedDays", reason, status,
                           created_at AS "createdAt"`,
                [
                    salonId, membership.membershipId, input.leaveTypeId,
                    input.startsOn, input.endsOn, input.requestedDays, input.reason,
                ]
            );
            return result.rows[0];
        });
    }

    async listLeaveRequests(
        salonId: string,
        query: DateRangeQuery,
        accountId?: string,
        status?: string
    ) {
        const result = await db.query(
            `SELECT request.id, request.membership_id AS "membershipId",
                    account.full_name AS "staffName",
                    request.leave_type_id AS "leaveTypeId", leave_type.name AS "leaveTypeName",
                    request.starts_on AS "startsOn", request.ends_on AS "endsOn",
                    request.requested_days::float8 AS "requestedDays",
                    request.reason, request.status,
                    request.review_note AS "reviewNote",
                    request.created_at AS "createdAt"
             FROM salon_employee_leave_requests AS request
             JOIN salon_employee_leave_types AS leave_type
               ON leave_type.id = request.leave_type_id AND leave_type.salon_id = request.salon_id
             JOIN salon_memberships AS membership ON membership.id = request.membership_id
             JOIN accounts AS account ON account.id = membership.account_id
             WHERE request.salon_id = $1
               AND request.starts_on <= $3::date AND request.ends_on >= $2::date
               AND ($4::uuid IS NULL OR membership.account_id = $4)
               AND ($5::varchar IS NULL OR request.status = $5)
             ORDER BY request.created_at DESC, request.id
             LIMIT $6 OFFSET $7`,
            [salonId, query.from, query.to, accountId ?? null, status ?? null, query.limit, query.offset]
        );
        return result.rows;
    }

    async reviewLeaveRequest(
        salonId: string,
        requestId: string,
        actorAccountId: string,
        input: ReviewLeaveRequest
    ) {
        return this.withTransaction(async (client) => {
            const result = await client.query<{
                membershipId: string;
                leaveTypeId: string;
                days: string;
                status: string;
                deductsBalance: boolean;
                isPaid: boolean;
            }>(
                `SELECT request.membership_id AS "membershipId",
                        request.leave_type_id AS "leaveTypeId",
                        request.requested_days::text AS days,
                        request.status, leave_type.deducts_balance AS "deductsBalance",
                        leave_type.is_paid AS "isPaid"
                 FROM salon_employee_leave_requests AS request
                 JOIN salon_employee_leave_types AS leave_type
                   ON leave_type.id = request.leave_type_id AND leave_type.salon_id = request.salon_id
                 WHERE request.id = $1 AND request.salon_id = $2
                 FOR UPDATE OF request`,
                [requestId, salonId]
            );
            const request = result.rows[0];
            if (!request) throw new ApiError(404, 'Leave request was not found');
            if (request.status !== 'PENDING') throw new ApiError(409, 'Only pending leave requests can be reviewed');
            await this.lockMembership(client, salonId, request.membershipId);
            if (input.status === 'APPROVED' && request.isPaid && request.deductsBalance) {
                const balance = await this.getLeaveBalance(
                    client, salonId, request.membershipId, request.leaveTypeId
                );
                if (balance < Number(request.days)) {
                    throw new ApiError(409, 'Leave balance is insufficient for this request');
                }
                await client.query(
                    `INSERT INTO salon_employee_leave_ledger (
                        salon_id, membership_id, leave_type_id, request_id,
                        entry_type, days_change, note, actor_account_id
                     ) VALUES ($1, $2, $3, $4, 'DEBIT', $5, $6, $7)`,
                    [
                        salonId, request.membershipId, request.leaveTypeId, requestId,
                        -Number(request.days), input.note ?? 'Approved paid leave',
                        actorAccountId,
                    ]
                );
            }
            const updated = await client.query(
                `UPDATE salon_employee_leave_requests
                 SET status = $3, reviewed_by_account_id = $4,
                     reviewed_at = CURRENT_TIMESTAMP, review_note = $5,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2
                 RETURNING id, status, reviewed_at AS "reviewedAt"`,
                [requestId, salonId, input.status, actorAccountId, input.note ?? null]
            );
            return updated.rows[0];
        });
    }

    async cancelLeaveRequest(salonId: string, requestId: string, accountId: string) {
        const result = await db.query(
            `UPDATE salon_employee_leave_requests AS request
             SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
             FROM salon_memberships AS membership
             WHERE request.id = $1 AND request.salon_id = $2
               AND request.membership_id = membership.id
               AND membership.account_id = $3
               AND request.status = 'PENDING'
             RETURNING request.id, request.status`,
            [requestId, salonId, accountId]
        );
        if (!result.rows[0]) {
            throw new ApiError(409, 'Only your pending leave requests can be cancelled');
        }
        return result.rows[0];
    }

    async createLeaveLedgerEntry(
        salonId: string,
        membershipId: string,
        actorAccountId: string,
        input: CreateLeaveLedgerEntryRequest
    ) {
        return this.withTransaction(async (client) => {
            const member = await client.query(
                `SELECT 1 FROM salon_membership_locations
                 WHERE salon_id = $1 AND membership_id = $2`,
                [salonId, membershipId]
            );
            if (!member.rowCount) throw new ApiError(404, 'Salon staff membership was not found');
            await this.lockMembership(client, salonId, membershipId);
            const type = await client.query(
                `SELECT 1 FROM salon_employee_leave_types
                 WHERE id = $1 AND salon_id = $2 AND is_active = TRUE`,
                [input.leaveTypeId, salonId]
            );
            if (!type.rowCount) throw new ApiError(404, 'Active leave type was not found');
            if (input.daysChange < 0) {
                const balance = await this.getLeaveBalance(
                    client, salonId, membershipId, input.leaveTypeId
                );
                if (balance < Math.abs(input.daysChange)) {
                    throw new ApiError(409, 'Leave adjustment would make the balance negative');
                }
            }
            const entry = await client.query(
                `INSERT INTO salon_employee_leave_ledger (
                    salon_id, membership_id, leave_type_id, entry_type,
                    days_change, note, actor_account_id
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id, days_change::float8 AS "daysChange",
                           note, created_at AS "createdAt"`,
                [
                    salonId, membershipId, input.leaveTypeId,
                    input.daysChange > 0 ? 'GRANT' : 'ADJUSTMENT',
                    input.daysChange, input.note, actorAccountId,
                ]
            );
            return entry.rows[0];
        });
    }

    async listLeaveBalances(salonId: string, accountId: string) {
        const membership = await this.getMembership(db, salonId, accountId);
        const result = await db.query(
            `SELECT leave_type.id AS "leaveTypeId", leave_type.name AS "leaveTypeName",
                    leave_type.is_paid AS "isPaid",
                    COALESCE(SUM(ledger.days_change), 0)::float8 AS "remainingDays"
             FROM salon_employee_leave_types AS leave_type
             LEFT JOIN salon_employee_leave_ledger AS ledger
               ON ledger.leave_type_id = leave_type.id
              AND ledger.salon_id = leave_type.salon_id
              AND ledger.membership_id = $2
             WHERE leave_type.salon_id = $1 AND leave_type.is_active = TRUE
             GROUP BY leave_type.id, leave_type.name, leave_type.is_paid
             ORDER BY leave_type.name`,
            [salonId, membership.membershipId]
        );
        return result.rows;
    }

    async getEmployeeLedger(salonId: string, accountId: string, query: DateRangeQuery) {
        const membership = await this.getMembership(db, salonId, accountId);
        return this.getMemberLedger(salonId, membership.membershipId, query);
    }

    async getMemberLedger(salonId: string, membershipId: string, query: DateRangeQuery) {
        await this.assertMembershipLocation(db, salonId, membershipId);
        const [shifts, work, leave] = await Promise.all([
            db.query(
                `SELECT shift.id, shift.clocked_in_at AS "clockedInAt",
                        shift.clocked_out_at AS "clockedOutAt",
                        GREATEST(EXTRACT(EPOCH FROM (
                            LEAST(COALESCE(shift.clocked_out_at, CURRENT_TIMESTAMP),
                                  ($3::date + 1)::timestamp AT TIME ZONE salon.timezone)
                            - GREATEST(shift.clocked_in_at, $2::date::timestamp AT TIME ZONE salon.timezone)
                        )) / 60 - COALESCE(lunch.minutes, 0), 0)::float8 AS "workedMinutes",
                        SUM(GREATEST(EXTRACT(EPOCH FROM (
                            LEAST(COALESCE(shift.clocked_out_at, CURRENT_TIMESTAMP),
                                  ($3::date + 1)::timestamp AT TIME ZONE salon.timezone)
                            - GREATEST(shift.clocked_in_at, $2::date::timestamp AT TIME ZONE salon.timezone)
                        )) / 60 - COALESCE(lunch.minutes, 0), 0)) OVER()::float8 AS "totalWorkedMinutes"
                 FROM salon_employee_shifts AS shift
                 JOIN salons AS salon ON salon.id = shift.salon_id
                 LEFT JOIN LATERAL (
                    SELECT SUM(EXTRACT(EPOCH FROM (
                        LEAST(COALESCE(break.ended_at, CURRENT_TIMESTAMP),
                              COALESCE(shift.clocked_out_at, CURRENT_TIMESTAMP),
                              ($3::date + 1)::timestamp AT TIME ZONE salon.timezone)
                        - GREATEST(break.started_at, shift.clocked_in_at,
                                   $2::date::timestamp AT TIME ZONE salon.timezone)
                    )) / 60) AS minutes
                    FROM salon_employee_lunch_breaks AS break
                    WHERE break.shift_id = shift.id
                      AND break.started_at < LEAST(
                          COALESCE(shift.clocked_out_at, CURRENT_TIMESTAMP),
                          ($3::date + 1)::timestamp AT TIME ZONE salon.timezone
                      )
                      AND COALESCE(break.ended_at, CURRENT_TIMESTAMP) >
                          GREATEST(shift.clocked_in_at, $2::date::timestamp AT TIME ZONE salon.timezone)
                 ) AS lunch ON TRUE
                 WHERE shift.salon_id = $1 AND shift.membership_id = $4
                   AND shift.clocked_in_at < ($3::date + 1)::timestamp AT TIME ZONE salon.timezone
                   AND COALESCE(shift.clocked_out_at, CURRENT_TIMESTAMP) >=
                       $2::date::timestamp AT TIME ZONE salon.timezone
                 ORDER BY shift.clocked_in_at DESC
                 LIMIT $5 OFFSET $6`,
                [salonId, query.from, query.to, membershipId, query.limit, query.offset]
            ),
            db.query(
                `WITH clipped AS (
                    SELECT GREATEST(
                               work.started_at,
                               $2::date::timestamp AT TIME ZONE salon.timezone
                           ) AS starts_at,
                           LEAST(
                               COALESCE(work.ended_at, CURRENT_TIMESTAMP),
                               ($3::date + 1)::timestamp AT TIME ZONE salon.timezone
                           ) AS ends_at
                    FROM salon_employee_service_work AS work
                    JOIN salons AS salon ON salon.id = work.salon_id
                    WHERE work.salon_id = $1 AND work.membership_id = $4
                      AND work.started_at < ($3::date + 1)::timestamp AT TIME ZONE salon.timezone
                      AND COALESCE(work.ended_at, CURRENT_TIMESTAMP) >
                          $2::date::timestamp AT TIME ZONE salon.timezone
                 ), merged AS (
                    SELECT range_agg(tstzrange(starts_at, ends_at, '[)')) AS intervals
                    FROM clipped
                    WHERE ends_at > starts_at
                 )
                 SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (upper(service_interval) - lower(service_interval))) / 60), 0)::float8
                        AS "activeWorkMinutes"
                 FROM merged, LATERAL unnest(merged.intervals) AS service_interval`,
                [salonId, query.from, query.to, membershipId]
            ),
            this.listLeaveRequestsForMembership(salonId, query, membershipId),
        ]);
        return {
            shifts: shifts.rows,
            totalWorkedMinutes: Number(shifts.rows[0]?.totalWorkedMinutes ?? 0),
            activeWorkMinutes: Number(work.rows[0]?.activeWorkMinutes ?? 0),
            leaveRequests: leave,
            leaveBalances: await this.listLeaveBalancesForMembership(salonId, membershipId),
        };
    }

    async listLeaveRequestsForMembership(
        salonId: string,
        query: DateRangeQuery,
        membershipId: string
    ) {
        const result = await db.query(
            `SELECT request.id, request.membership_id AS "membershipId",
                    request.leave_type_id AS "leaveTypeId", leave_type.name AS "leaveTypeName",
                    request.starts_on AS "startsOn", request.ends_on AS "endsOn",
                    request.requested_days::float8 AS "requestedDays",
                    request.reason, request.status, request.review_note AS "reviewNote",
                    request.created_at AS "createdAt"
             FROM salon_employee_leave_requests AS request
             JOIN salon_employee_leave_types AS leave_type
               ON leave_type.id = request.leave_type_id AND leave_type.salon_id = request.salon_id
             WHERE request.salon_id = $1 AND request.membership_id = $4
               AND request.starts_on <= $3::date AND request.ends_on >= $2::date
             ORDER BY request.created_at DESC, request.id
             LIMIT $5 OFFSET $6`,
            [salonId, query.from, query.to, membershipId, query.limit, query.offset]
        );
        return result.rows;
    }

    async listLeaveBalancesForMembership(salonId: string, membershipId: string) {
        await this.assertMembershipLocation(db, salonId, membershipId);
        const result = await db.query(
            `SELECT leave_type.id AS "leaveTypeId", leave_type.name AS "leaveTypeName",
                    leave_type.is_paid AS "isPaid",
                    COALESCE(SUM(ledger.days_change), 0)::float8 AS "remainingDays"
             FROM salon_employee_leave_types AS leave_type
             LEFT JOIN salon_employee_leave_ledger AS ledger
               ON ledger.leave_type_id = leave_type.id
              AND ledger.salon_id = leave_type.salon_id
              AND ledger.membership_id = $2
             WHERE leave_type.salon_id = $1 AND leave_type.is_active = TRUE
             GROUP BY leave_type.id, leave_type.name, leave_type.is_paid
             ORDER BY leave_type.name`,
            [salonId, membershipId]
        );
        return result.rows;
    }

    async startServiceWork(salonId: string, actorAccountId: string, input: CreateServiceWorkRequest) {
        return this.withTransaction(async (client) => {
            const sourceCheck = input.sourceType === 'QUEUE'
                ? `SELECT assignment.id, assignment.service_id AS "serviceId",
                          assignment.membership_id AS "membershipId"
                   FROM queue_entry_staff AS assignment
                   WHERE assignment.id = $1 AND assignment.salon_id = $2
                     AND assignment.status IN ('SCHEDULED', 'IN_PROGRESS')`
                : `SELECT item.id, item.service_id AS "serviceId",
                          item.staff_membership_id AS "membershipId"
                   FROM pos_bill_items AS item
                   JOIN pos_bills AS bill ON bill.id = item.bill_id AND bill.salon_id = item.salon_id
                   WHERE item.id = $1 AND item.salon_id = $2
                     AND item.item_type = 'SERVICE' AND item.removed_at IS NULL
                     AND bill.status <> 'CANCELLED'`;
            const source = await client.query(sourceCheck, [input.sourceId, salonId]);
            const sourceRow = source.rows[0];
            if (!sourceRow || sourceRow.serviceId !== input.serviceId) {
                throw new ApiError(404, 'Assigned service work source was not found');
            }
            if (sourceRow.membershipId !== input.membershipId) {
                throw new ApiError(403, 'Service work can only be recorded for its assigned staff member');
            }
            const shift = await client.query(
                `SELECT id FROM salon_employee_shifts
                 WHERE salon_id = $1 AND membership_id = $2 AND clocked_out_at IS NULL
                 FOR UPDATE`,
                [salonId, input.membershipId]
            );
            if (!shift.rows[0]) {
                throw new ApiError(409, 'Staff must be clocked in before starting service work');
            }
            const lunch = await client.query(
                `SELECT 1 FROM salon_employee_lunch_breaks
                 WHERE shift_id = $1 AND ended_at IS NULL`,
                [shift.rows[0].id]
            );
            if (lunch.rowCount) throw new ApiError(409, 'Staff cannot start service work during lunch');
            try {
                const result = await client.query(
                    `INSERT INTO salon_employee_service_work (
                        salon_id, membership_id, service_id, queue_entry_staff_id, bill_item_id,
                        started_by_account_id
                     ) VALUES ($1, $2, $3, $4, $5, $6)
                     RETURNING id, membership_id AS "membershipId", service_id AS "serviceId",
                               started_at AS "startedAt"`,
                    [
                        salonId, input.membershipId, input.serviceId,
                        input.sourceType === 'QUEUE' ? input.sourceId : null,
                        input.sourceType === 'POS' ? input.sourceId : null,
                        actorAccountId,
                    ]
                );
                return result.rows[0];
            } catch (error) {
                if (isUniqueViolation(error)) {
                    throw new ApiError(409, 'Service work is already recorded for this assignment');
                }
                throw error;
            }
        });
    }

    async endServiceWork(salonId: string, workId: string, actorAccountId: string) {
        const result = await db.query(
            `UPDATE salon_employee_service_work
             SET ended_at = CURRENT_TIMESTAMP, ended_by_account_id = $3
             WHERE id = $1 AND salon_id = $2 AND ended_at IS NULL
             RETURNING id, membership_id AS "membershipId", service_id AS "serviceId",
                       started_at AS "startedAt", ended_at AS "endedAt"`,
            [workId, salonId, actorAccountId]
        );
        if (!result.rows[0]) throw new ApiError(404, 'Open service work record was not found');
        return result.rows[0];
    }

    async createTipRequest(
        salonId: string,
        actorAccountId: string,
        input: CreateTipRequest,
        source: 'CUSTOMER' | 'DESK'
    ) {
        const bill = await db.query<{
            sessionId: string;
            customerAccountId: string;
        }>(
            `SELECT session.id AS "sessionId",
                    session.customer_account_id AS "customerAccountId"
             FROM pos_bills AS bill
             JOIN pos_billing_sessions AS session
               ON session.id = bill.session_id AND session.salon_id = bill.salon_id
             WHERE bill.id = $1 AND bill.salon_id = $2
               AND bill.workflow_status = 'CONFIRMED'`,
            [input.billId, salonId]
        );
        const billRow = bill.rows[0];
        if (!billRow) throw new ApiError(404, 'Confirmed POS bill was not found');
        if (source === 'CUSTOMER' && billRow.customerAccountId !== actorAccountId) {
            throw new ApiError(403, 'Customers can request tips only for their own confirmed bill');
        }
        const assigned = await db.query(
            `SELECT 1
             FROM pos_bill_items AS item
             WHERE item.bill_id = $1 AND item.salon_id = $2
               AND item.staff_membership_id = $3 AND item.item_type = 'SERVICE'
               AND item.removed_at IS NULL
             UNION
             SELECT 1
             FROM salon_employee_service_work AS work
             WHERE work.salon_id = $2 AND work.membership_id = $3
               AND work.bill_item_id IN (
                   SELECT id FROM pos_bill_items
                   WHERE bill_id = $1 AND salon_id = $2 AND removed_at IS NULL
               )
             LIMIT 1`,
            [input.billId, salonId, input.membershipId]
        );
        if (!assigned.rowCount) throw new ApiError(400, 'Tip recipient must be assigned to a service on this bill');
        try {
            const result = await db.query(
                `INSERT INTO salon_employee_tip_requests (
                    salon_id, session_id, bill_id, membership_id, customer_account_id,
                    amount, source, requested_by_account_id, idempotency_key
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id, bill_id AS "billId", membership_id AS "membershipId",
                           amount::float8 AS amount, source, status,
                           created_at AS "createdAt"`,
                [
                    salonId, billRow.sessionId, input.billId, input.membershipId,
                    billRow.customerAccountId, input.amount, source, actorAccountId,
                    input.idempotencyKey ?? null,
                ]
            );
            return result.rows[0];
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new ApiError(409, 'A pending or approved tip already exists for this bill and staff member, or the idempotency key was already used');
            }
            throw error;
        }
    }

    async listTipRequests(salonId: string, query: DateRangeQuery, status?: string) {
        const result = await db.query(
            `SELECT request.id, request.bill_id AS "billId",
                    request.membership_id AS "membershipId",
                    account.full_name AS "staffName",
                    request.customer_account_id AS "customerAccountId",
                    request.amount::float8 AS amount, request.source, request.status,
                    request.review_note AS "reviewNote", request.created_at AS "createdAt"
             FROM salon_employee_tip_requests AS request
             JOIN salon_memberships AS membership ON membership.id = request.membership_id
             JOIN accounts AS account ON account.id = membership.account_id
             JOIN salons AS salon ON salon.id = request.salon_id
             WHERE request.salon_id = $1
               AND request.created_at >= ($2::date::timestamp AT TIME ZONE salon.timezone)
               AND request.created_at < (($3::date + 1)::timestamp AT TIME ZONE salon.timezone)
               AND ($4::varchar IS NULL OR request.status = $4)
             ORDER BY request.created_at DESC, request.id
             LIMIT $5 OFFSET $6`,
            [salonId, query.from, query.to, status ?? null, query.limit, query.offset]
        );
        return result.rows;
    }

    async reviewTipRequest(
        salonId: string,
        requestId: string,
        actorAccountId: string,
        input: ReviewTipRequest
    ) {
        return this.withTransaction(async (client) => {
            const result = await client.query<{
                membershipId: string;
                amount: string;
                status: string;
            }>(
                `SELECT membership_id AS "membershipId", amount::text AS amount, status
                 FROM salon_employee_tip_requests
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [requestId, salonId]
            );
            const request = result.rows[0];
            if (!request) throw new ApiError(404, 'Tip request was not found');
            if (request.status !== 'PENDING') throw new ApiError(409, 'Only pending tip requests can be reviewed');
            if (input.status === 'APPROVED') {
                await client.query(
                    `INSERT INTO pos_tips (
                        session_id, salon_id, staff_membership_id, request_id, amount
                     )
                     SELECT session_id, salon_id, membership_id, id, amount
                     FROM salon_employee_tip_requests
                     WHERE id = $1 AND salon_id = $2`,
                    [requestId, salonId]
                );
                await client.query(
                    `INSERT INTO salon_employee_tip_ledger (
                        salon_id, request_id, membership_id, amount_change,
                        entry_type, actor_account_id, note
                     ) VALUES ($1, $2, $3, $4, 'TIP_CREDIT', $5, $6)`,
                    [
                        salonId, requestId, request.membershipId,
                        request.amount, actorAccountId, input.note ?? null,
                    ]
                );
            }
            const updated = await client.query(
                `UPDATE salon_employee_tip_requests
                 SET status = $3, reviewed_by_account_id = $4,
                     reviewed_at = CURRENT_TIMESTAMP, review_note = $5
                 WHERE id = $1 AND salon_id = $2
                 RETURNING id, status, reviewed_at AS "reviewedAt"`,
                [requestId, salonId, input.status, actorAccountId, input.note ?? null]
            );
            return updated.rows[0];
        });
    }

    async createTipRefundRequest(
        salonId: string,
        actorAccountId: string,
        input: CreateTipRefundRequest,
        source: 'CUSTOMER' | 'DESK'
    ) {
        try {
            return await this.withTransaction(async (client) => {
                const tipResult = await client.query<{
                    customerAccountId: string;
                    amount: string;
                    status: string;
                }>(
                    `SELECT tip_request.customer_account_id AS "customerAccountId",
                            tip_request.amount::text AS amount, tip_request.status
                     FROM salon_employee_tip_requests AS tip_request
                     JOIN pos_tips AS tip
                       ON tip.request_id = tip_request.id AND tip.salon_id = tip_request.salon_id
                     WHERE tip_request.id = $1 AND tip_request.salon_id = $2
                     FOR UPDATE OF tip_request`,
                    [input.tipRequestId, salonId]
                );
                const tip = tipResult.rows[0];
                if (!tip || tip.status !== 'APPROVED') {
                    throw new ApiError(404, 'Approved staff tip was not found');
                }
                if (source === 'CUSTOMER' && tip.customerAccountId !== actorAccountId) {
                    throw new ApiError(403, 'Customers can request a refund only for their own tip');
                }
                const reservedResult = await client.query<{ wouldExceed: boolean }>(
                    `SELECT COALESCE(SUM(amount), 0) + $3::numeric > $4::numeric AS "wouldExceed"
                     FROM salon_employee_tip_refund_requests
                     WHERE salon_id = $1 AND tip_request_id = $2
                       AND status IN ('PENDING', 'PAYOUT_PENDING', 'COMPLETED')`,
                    [salonId, input.tipRequestId, input.amount, tip.amount]
                );
                if (reservedResult.rows[0]?.wouldExceed) {
                    throw new ApiError(409, 'Refund amount exceeds the tip amount still refundable');
                }
                const result = await client.query(
                    `INSERT INTO salon_employee_tip_refund_requests (
                        salon_id, tip_request_id, customer_account_id, amount, reason,
                        source, requested_by_account_id, idempotency_key
                     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     RETURNING id, tip_request_id AS "tipRequestId",
                               amount::float8 AS amount, reason, source, status,
                               created_at AS "createdAt"`,
                    [
                        salonId, input.tipRequestId, tip.customerAccountId, input.amount,
                        input.reason, source, actorAccountId, input.idempotencyKey,
                    ]
                );
                return result.rows[0];
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new ApiError(409, 'This idempotency key has already been used');
            }
            throw error;
        }
    }

    async listTipRefundRequests(
        salonId: string,
        query: DateRangeQuery,
        status?: string,
        customerAccountId?: string
    ) {
        const result = await db.query(
            `SELECT refund.id, refund.tip_request_id AS "tipRequestId",
                    tip_request.bill_id AS "billId",
                    tip_request.membership_id AS "membershipId",
                    staff.full_name AS "staffName",
                    refund.customer_account_id AS "customerAccountId",
                    refund.amount::float8 AS amount, refund.reason, refund.source,
                    refund.status, refund.review_note AS "reviewNote",
                    refund.payout_reference AS "payoutReference",
                    refund.completion_note AS "completionNote",
                    refund.created_at AS "createdAt",
                    refund.reviewed_at AS "reviewedAt",
                    refund.completed_at AS "completedAt"
             FROM salon_employee_tip_refund_requests AS refund
             JOIN salon_employee_tip_requests AS tip_request
               ON tip_request.id = refund.tip_request_id
              AND tip_request.salon_id = refund.salon_id
             JOIN salon_memberships AS membership ON membership.id = tip_request.membership_id
             JOIN accounts AS staff ON staff.id = membership.account_id
             JOIN salons AS salon ON salon.id = refund.salon_id
             WHERE refund.salon_id = $1
               AND refund.created_at >= ($2::date::timestamp AT TIME ZONE salon.timezone)
               AND refund.created_at < (($3::date + 1)::timestamp AT TIME ZONE salon.timezone)
               AND ($4::varchar IS NULL OR refund.status = $4)
               AND ($5::uuid IS NULL OR refund.customer_account_id = $5)
             ORDER BY refund.created_at DESC, refund.id
             LIMIT $6 OFFSET $7`,
            [
                salonId, query.from, query.to, status ?? null,
                customerAccountId ?? null, query.limit, query.offset,
            ]
        );
        return result.rows;
    }

    async reviewTipRefundRequest(
        salonId: string,
        refundRequestId: string,
        actorAccountId: string,
        input: ReviewTipRefundRequest
    ) {
        return this.withTransaction(async (client) => {
            const result = await client.query<{
                tipRequestId: string;
                status: string;
            }>(
                `SELECT tip_request_id AS "tipRequestId", status
                 FROM salon_employee_tip_refund_requests
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [refundRequestId, salonId]
            );
            const refund = result.rows[0];
            if (!refund) throw new ApiError(404, 'Tip refund request was not found');
            if (refund.status !== 'PENDING') {
                throw new ApiError(409, 'Only pending tip refund requests can be reviewed');
            }
            await client.query(
                `SELECT id FROM salon_employee_tip_requests
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [refund.tipRequestId, salonId]
            );
            const updated = await client.query(
                `UPDATE salon_employee_tip_refund_requests
                 SET status = $3, reviewed_by_account_id = $4,
                     reviewed_at = CURRENT_TIMESTAMP, review_note = $5
                 WHERE id = $1 AND salon_id = $2
                 RETURNING id, status, reviewed_at AS "reviewedAt"`,
                [
                    refundRequestId, salonId,
                    input.status === 'APPROVED' ? 'PAYOUT_PENDING' : 'REJECTED',
                    actorAccountId, input.note ?? null,
                ]
            );
            return updated.rows[0];
        });
    }

    async completeTipRefundRequest(
        salonId: string,
        refundRequestId: string,
        actorAccountId: string,
        input: CompleteTipRefundRequest
    ) {
        return this.withTransaction(async (client) => {
            const result = await client.query<{
                tipRequestId: string;
                membershipId: string;
                amount: string;
                status: string;
                payoutReference: string | null;
                completedAt: Date | null;
            }>(
                `SELECT refund.tip_request_id AS "tipRequestId",
                        tip_request.membership_id AS "membershipId",
                        refund.amount::text AS amount, refund.status,
                        refund.payout_reference AS "payoutReference",
                        refund.completed_at AS "completedAt"
                 FROM salon_employee_tip_refund_requests AS refund
                 JOIN salon_employee_tip_requests AS tip_request
                   ON tip_request.id = refund.tip_request_id
                  AND tip_request.salon_id = refund.salon_id
                 WHERE refund.id = $1 AND refund.salon_id = $2
                 FOR UPDATE OF refund`,
                [refundRequestId, salonId]
            );
            const refund = result.rows[0];
            if (!refund) throw new ApiError(404, 'Tip refund request was not found');
            if (refund.status === 'COMPLETED') {
                return {
                    id: refundRequestId,
                    tipRequestId: refund.tipRequestId,
                    amount: Number(refund.amount),
                    status: 'COMPLETED',
                    payoutReference: refund.payoutReference,
                    completedAt: refund.completedAt,
                };
            }
            if (refund.status !== 'PAYOUT_PENDING') {
                throw new ApiError(409, 'Only approved tip refunds awaiting payout can be completed');
            }
            await client.query(
                `SELECT id FROM salon_employee_tip_requests
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [refund.tipRequestId, salonId]
            );
            await client.query(
                `INSERT INTO salon_employee_tip_ledger (
                    salon_id, request_id, refund_request_id, membership_id,
                    amount_change, entry_type, actor_account_id, note
                 ) VALUES ($1, $2, $3, $4, $5, 'REVERSAL', $6, $7)`,
                [
                    salonId, refund.tipRequestId, refundRequestId, refund.membershipId,
                    -Number(refund.amount), actorAccountId,
                    input.note,
                ]
            );
            const updated = await client.query(
                `UPDATE salon_employee_tip_refund_requests
                 SET status = 'COMPLETED', completed_by_account_id = $3,
                     completed_at = CURRENT_TIMESTAMP, payout_reference = $4,
                     completion_note = $5
                 WHERE id = $1 AND salon_id = $2
                 RETURNING id, tip_request_id AS "tipRequestId",
                           amount::float8 AS amount, status,
                           payout_reference AS "payoutReference",
                           completed_at AS "completedAt"`,
                [
                    refundRequestId, salonId, actorAccountId,
                    input.payoutReference ?? null, input.note ?? null,
                ]
            );
            return updated.rows[0];
        });
    }

    async getMyTipLedger(salonId: string, accountId: string, query: DateRangeQuery) {
        const membership = await this.getMembership(db, salonId, accountId);
        return this.getTipLedgerForMembership(salonId, membership.membershipId, query);
    }

    async getTipLedgerForMembership(salonId: string, membershipId: string, query: DateRangeQuery) {
        await this.assertMembershipLocation(db, salonId, membershipId);
        const result = await db.query(
            `SELECT ledger.id, ledger.request_id AS "requestId",
                    ledger.refund_request_id AS "refundRequestId",
                    ledger.entry_type AS "entryType",
                    ledger.amount_change::float8 AS "amountChange", ledger.note,
                    ledger.created_at AS "createdAt"
             FROM salon_employee_tip_ledger AS ledger
             JOIN salons AS salon ON salon.id = ledger.salon_id
             WHERE ledger.salon_id = $1 AND ledger.membership_id = $2
               AND ledger.created_at >= ($3::date::timestamp AT TIME ZONE salon.timezone)
               AND ledger.created_at < (($4::date + 1)::timestamp AT TIME ZONE salon.timezone)
             ORDER BY ledger.created_at DESC, ledger.id
             LIMIT $5 OFFSET $6`,
            [salonId, membershipId, query.from, query.to, query.limit, query.offset]
        );
        const balance = await db.query(
            `SELECT COALESCE(SUM(amount_change), 0)::float8 AS balance
             FROM salon_employee_tip_ledger
             WHERE salon_id = $1 AND membership_id = $2`,
            [salonId, membershipId]
        );
        return { balance: Number(balance.rows[0]?.balance ?? 0), entries: result.rows };
    }

    private async assertMembershipLocation(
        client: Pick<PoolClient, 'query'> | typeof db,
        salonId: string,
        membershipId: string
    ) {
        const result = await client.query(
            `SELECT 1 FROM salon_membership_locations
             WHERE salon_id = $1 AND membership_id = $2`,
            [salonId, membershipId]
        );
        if (!result.rowCount) throw new ApiError(404, 'Salon staff membership was not found');
    }

    private async getMembership(
        client: Pick<PoolClient, 'query'> | typeof db,
        salonId: string,
        accountId: string
    ): Promise<MembershipRow> {
        const result = await client.query<MembershipRow>(
            `SELECT membership.id AS "membershipId",
                    membership.organization_id AS "organizationId"
             FROM salon_memberships AS membership
             JOIN salon_membership_locations AS location
               ON location.membership_id = membership.id
             WHERE location.salon_id = $1 AND membership.account_id = $2
               AND membership.status = 'ACTIVE'
             LIMIT 1`,
            [salonId, accountId]
        );
        if (!result.rows[0]) throw new ApiError(403, 'Active salon staff membership is required');
        return result.rows[0];
    }

    private async getLeaveBalance(
        client: PoolClient,
        salonId: string,
        membershipId: string,
        leaveTypeId: string
    ): Promise<number> {
        const result = await client.query<{ balance: string }>(
            `SELECT COALESCE(SUM(days_change), 0)::text AS balance
             FROM salon_employee_leave_ledger
             WHERE salon_id = $1 AND membership_id = $2 AND leave_type_id = $3`,
            [salonId, membershipId, leaveTypeId]
        );
        return Number(result.rows[0]?.balance ?? 0);
    }

    private async lockMembership(client: PoolClient, salonId: string, membershipId: string) {
        const result = await client.query(
            `SELECT id FROM salon_memberships
             WHERE id = $1
               AND EXISTS (
                   SELECT 1 FROM salon_membership_locations
                   WHERE membership_id = $1 AND salon_id = $2
               )
             FOR UPDATE`,
            [membershipId, salonId]
        );
        if (!result.rowCount) throw new ApiError(404, 'Salon staff membership was not found');
    }

    private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

function isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null
        && 'code' in error && error.code === '23505';
}
