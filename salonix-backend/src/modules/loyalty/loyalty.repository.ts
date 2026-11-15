import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import {
    allocatePointsFifo,
    calculateEffectiveExpiry,
    calculatePointsAward,
    calculateQualifyingSpend,
    calculateRefundReversal,
    InsufficientPointsError,
    roundPoints,
} from './loyalty.calculations.js';
import type {
    LoyaltyCategory,
    LoyaltyLedgerEntry,
    LoyaltyPreview,
    LoyaltyProgramEvent,
    LoyaltyProgramSettings,
    LoyaltyWallet,
    PointsLot,
    UpdateLoyaltyProgramRequest,
} from './loyalty.types.js';

interface ProgramRow extends QueryResultRow {
    salonId: string;
    minimumSpend: string;
    rewardPercentage: string;
    pointConversionRate: string;
    pointsExpiryDays: number;
    isActive: boolean;
    closedAt: Date | null;
    redeemUntil: Date | null;
    expiryLockedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    eligibleCategories: LoyaltyCategory[];
}

interface ProgramState {
    salonId: string;
    minimumSpend: number;
    rewardPercentage: number;
    pointConversionRate: number;
    pointsExpiryDays: number;
    isActive: boolean;
    closedAt: Date | null;
    redeemUntil: Date | null;
}

interface BillItemTotal extends QueryResultRow {
    category: string;
    qualifyingSpend: string;
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export class LoyaltyRepository {
    async getProgram(salonId: string): Promise<LoyaltyProgramSettings | null> {
        const client = await db.connect();
        try {
            return await this.loadProgram(client, salonId);
        } finally {
            client.release();
        }
    }

    async getPublicProgram(salonId: string): Promise<LoyaltyProgramSettings | null> {
        return this.getProgram(salonId);
    }

    async updateProgram(
        salonId: string,
        actorAccountId: string,
        input: UpdateLoyaltyProgramRequest
    ): Promise<LoyaltyProgramSettings> {
        return this.withTransaction(async (client) => {
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
                [`loyalty-program:${salonId}`]
            );
            await client.query(
                `SELECT salon_id
                 FROM salon_loyalty_programs
                 WHERE salon_id = $1
                 FOR UPDATE`,
                [salonId]
            );
            const previous = await this.loadProgram(client, salonId);
            if (previous?.closedAt) {
                throw new ApiError(409, 'A closed loyalty program cannot be changed');
            }
            const hasEarnings = await client.query<{ exists: boolean }>(
                `SELECT EXISTS (
                    SELECT 1 FROM customer_loyalty_ledger
                    WHERE salon_id = $1 AND entry_type = 'EARNED'
                ) AS exists`,
                [salonId]
            );
            if (hasEarnings.rows[0].exists && previous) {
                if (
                    input.pointsExpiryDays !== previous.pointsExpiryDays ||
                    input.pointConversionRate !== previous.pointConversionRate
                ) {
                    throw new ApiError(
                        409,
                        'Point expiry and conversion settings cannot change after points have been issued'
                    );
                }
            }
            await client.query<ProgramRow>(
                `INSERT INTO salon_loyalty_programs (
                    salon_id, minimum_spend, reward_percentage, point_conversion_rate,
                    points_expiry_days, is_active, closed_at, redeem_until,
                    expiry_locked_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    CASE WHEN $6 = FALSE AND $7 = TRUE THEN CURRENT_TIMESTAMP ELSE NULL END,
                    CASE WHEN $6 = FALSE AND $7 = TRUE
                         THEN CURRENT_TIMESTAMP + INTERVAL '1 year' ELSE NULL END,
                    CASE WHEN $8 = TRUE THEN CURRENT_TIMESTAMP ELSE NULL END
                )
                ON CONFLICT (salon_id) DO UPDATE SET
                    minimum_spend = EXCLUDED.minimum_spend,
                    reward_percentage = EXCLUDED.reward_percentage,
                    point_conversion_rate = EXCLUDED.point_conversion_rate,
                    points_expiry_days = EXCLUDED.points_expiry_days,
                    is_active = EXCLUDED.is_active,
                    closed_at = CASE
                        WHEN salon_loyalty_programs.is_active AND NOT EXCLUDED.is_active
                        THEN CURRENT_TIMESTAMP
                        ELSE salon_loyalty_programs.closed_at
                    END,
                    redeem_until = CASE
                        WHEN salon_loyalty_programs.is_active AND NOT EXCLUDED.is_active
                        THEN CURRENT_TIMESTAMP + INTERVAL '1 year'
                        ELSE salon_loyalty_programs.redeem_until
                    END,
                    expiry_locked_at = COALESCE(
                        salon_loyalty_programs.expiry_locked_at,
                        EXCLUDED.expiry_locked_at
                    ),
                    updated_at = CURRENT_TIMESTAMP
                RETURNING
                    salon_id AS "salonId",
                    minimum_spend::text AS "minimumSpend",
                    reward_percentage::text AS "rewardPercentage",
                    point_conversion_rate::text AS "pointConversionRate",
                    points_expiry_days AS "pointsExpiryDays",
                    is_active AS "isActive",
                    closed_at AS "closedAt",
                    redeem_until AS "redeemUntil",
                    expiry_locked_at AS "expiryLockedAt",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt",
                    ARRAY[]::text[] AS "eligibleCategories"`,
                [
                    salonId,
                    input.minimumSpend,
                    input.rewardPercentage,
                    input.pointConversionRate,
                    input.pointsExpiryDays,
                    input.isActive,
                    previous?.isActive ?? false,
                    hasEarnings.rows[0].exists,
                ]
            );

            await client.query(
                `UPDATE salon_loyalty_eligible_categories
                 SET is_eligible = FALSE
                 WHERE salon_id = $1`,
                [salonId]
            );
            for (const category of input.eligibleCategories) {
                await client.query(
                    `INSERT INTO salon_loyalty_eligible_categories (salon_id, category, is_eligible)
                     VALUES ($1, $2, TRUE)
                     ON CONFLICT (salon_id, category)
                     DO UPDATE SET is_eligible = TRUE`,
                    [salonId, category]
                );
            }

            const current = await this.loadProgram(client, salonId);
            if (!current) throw new ApiError(500, 'Loyalty program could not be loaded after saving');
            await client.query(
                `INSERT INTO salon_loyalty_program_events (
                    salon_id, event_type, before_state, after_state, actor_account_id
                 ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
                [
                    salonId,
                    !previous ? 'CREATED' : previous.isActive && !input.isActive ? 'CLOSED' : 'UPDATED',
                    previous ? JSON.stringify(previous) : null,
                    JSON.stringify(current),
                    actorAccountId,
                ]
            );
            return current;
        });
    }

    async previewBill(salonId: string, billId: string): Promise<LoyaltyPreview> {
        return this.withTransaction(async (client) => {
            const program = await this.loadProgram(client, salonId);
            const bill = await client.query<{ id: string }>(
                `SELECT id FROM pos_bills WHERE id = $1 AND salon_id = $2`,
                [billId, salonId]
            );
            if (!bill.rowCount) throw new ApiError(404, 'POS bill was not found');
            return this.buildPreview(client, salonId, billId, program);
        });
    }

    async awardForSettledBill(salonId: string, billId: string) {
        return this.withTransaction(async (client) => {
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
                [`loyalty-bill:${salonId}:${billId}`]
            );
            await this.lockProgram(client, salonId);
            const bill = await client.query<{
                customerAccountId: string;
                workflowStatus: string;
                totalAmount: string;
            }>(
                `SELECT session.customer_account_id AS "customerAccountId",
                        bill.workflow_status AS "workflowStatus",
                        bill.total_amount::text AS "totalAmount"
                 FROM pos_bills AS bill
                 JOIN pos_billing_sessions AS session
                   ON session.id = bill.session_id AND session.salon_id = bill.salon_id
                 WHERE bill.id = $1 AND bill.salon_id = $2
                 FOR UPDATE OF bill`,
                [billId, salonId]
            );
            if (!bill.rowCount) throw new ApiError(404, 'POS bill was not found');
            const billRow = bill.rows[0];
            const paymentTotals = await client.query<{ paidAmount: string }>(
                `SELECT COALESCE(SUM(amount), 0)::text AS "paidAmount"
                 FROM pos_payments
                 WHERE bill_id = $1 AND salon_id = $2 AND status = 'SUCCESS'`,
                [billId, salonId]
            );
            if (
                billRow.workflowStatus !== 'CONFIRMED' ||
                Number(paymentTotals.rows[0].paidAmount) < Number(billRow.totalAmount)
            ) {
                return { pointsEarned: 0, reason: 'BILL_NOT_SETTLED' as const };
            }

            const program = await this.loadProgram(client, salonId);
            if (!program?.isActive) return { pointsEarned: 0, reason: 'PROGRAM_INACTIVE' as const };
            const preview = await this.buildPreview(client, salonId, billId, program);
            if (preview.pointsEarned <= 0) {
                return { pointsEarned: 0, reason: 'MINIMUM_NOT_MET_OR_NO_REWARD' as const, preview };
            }
            const refunds = await client.query<{ amount: string }>(
                `SELECT COALESCE(SUM(amount), 0)::text AS amount
                 FROM pos_refunds
                 WHERE bill_id = $1 AND salon_id = $2 AND status = 'COMPLETED'`,
                [billId, salonId]
            );
            const refundedAmountAtAward = Math.min(
                Number(refunds.rows[0].amount),
                Number(billRow.totalAmount)
            );
            const pointsEarned = Number(billRow.totalAmount) > 0
                ? roundPoints(
                    preview.pointsEarned *
                    (Number(billRow.totalAmount) - refundedAmountAtAward) /
                    Number(billRow.totalAmount)
                )
                : 0;
            if (pointsEarned <= 0) {
                return { pointsEarned: 0, reason: 'BILL_REFUNDED' as const, preview };
            }

            const id = randomUUID();
            const inserted = await client.query<{ id: string }>(
                `INSERT INTO customer_loyalty_ledger (
                    id, customer_account_id, salon_id, amount, transaction_reference,
                    expires_at, entry_type, idempotency_key, metadata
                 ) VALUES (
                    $1, $2, $3, $4, $5,
                    CURRENT_TIMESTAMP + ($6::integer * INTERVAL '1 day'),
                    'EARNED', $7, $8::jsonb
                 )
                 ON CONFLICT (salon_id, idempotency_key)
                 DO NOTHING
                 RETURNING id`,
                [
                    id,
                    billRow.customerAccountId,
                    salonId,
                    pointsEarned,
                    billId,
                    program.pointsExpiryDays,
                    `pos-loyalty-earned:${billId}`,
                    JSON.stringify({
                        billId,
                        qualifyingSpend: preview.qualifyingSpend,
                        grossPointsEarned: preview.pointsEarned,
                        refundedAmountAtAward,
                        rewardPercentage: program.rewardPercentage,
                        pointConversionRate: program.pointConversionRate,
                        pointsExpiryDays: program.pointsExpiryDays,
                        minimumSpend: program.minimumSpend,
                        eligibleCategories: program.eligibleCategories,
                    }),
                ]
            );
            if (inserted.rowCount) {
                await client.query(
                    `UPDATE salon_loyalty_programs
                     SET expiry_locked_at = COALESCE(expiry_locked_at, CURRENT_TIMESTAMP)
                     WHERE salon_id = $1`,
                    [salonId]
                );
            }
            return {
                pointsEarned: inserted.rowCount ? pointsEarned : 0,
                duplicate: !inserted.rowCount,
                preview,
            };
        });
    }

    async getCustomerWallet(customerAccountId: string, salonId: string): Promise<LoyaltyWallet> {
        return this.withTransaction(async (client) => {
            await this.lockWallet(client, customerAccountId, salonId);
            await this.lockProgram(client, salonId);
            let program = await this.loadProgram(client, salonId);
            if (!program) {
                return {
                    salonId,
                    customerAccountId,
                    pointsBalance: 0,
                    redemptionValue: 0,
                    pointConversionRate: 1,
                    expiresAt: null,
                    redeemUntil: null,
                    expiringPoints: [],
                };
            }
            await this.expireDuePoints(client, customerAccountId, salonId);
            program = (await this.loadProgram(client, salonId)) ?? program;
            const lots = await this.readPointLots(client, customerAccountId, salonId, false);
            const pointsBalance = roundPoints(lots.reduce((sum, lot) => sum + lot.remaining, 0));
            return {
                salonId,
                customerAccountId,
                pointsBalance,
                redemptionValue: roundMoney(pointsBalance / program.pointConversionRate),
                pointConversionRate: program.pointConversionRate,
                expiresAt: lots[0]?.expiresAt ?? null,
                redeemUntil: program.redeemUntil,
                expiringPoints: lots
                    .slice(0, 10)
                    .map((lot) => ({ points: lot.remaining, expiresAt: lot.expiresAt })),
            };
        });
    }

    async listCustomerLedger(
        customerAccountId: string,
        salonId: string,
        limit: number,
        offset: number
    ): Promise<LoyaltyLedgerEntry[]> {
        return this.withTransaction(async (client) => {
            await this.lockWallet(client, customerAccountId, salonId);
            await this.lockProgram(client, salonId);
            const program = await this.loadProgram(client, salonId);
            if (program) await this.expireDuePoints(client, customerAccountId, salonId);
            const result = await client.query<{
                id: string;
                amount: string;
                entryType: LoyaltyLedgerEntry['entryType'];
                transactionReference: string | null;
                expiresAt: Date | null;
                metadata: Record<string, unknown>;
                createdAt: Date;
            }>(
                `SELECT id, amount::text AS amount, entry_type AS "entryType",
                        transaction_reference AS "transactionReference",
                        expires_at AS "expiresAt", metadata, created_at AS "createdAt"
                 FROM customer_loyalty_ledger
                 WHERE customer_account_id = $1 AND salon_id = $2
                 ORDER BY created_at DESC, id DESC
                 LIMIT $3 OFFSET $4`,
                [customerAccountId, salonId, limit, offset]
            );
            return result.rows.map((row) => ({
                ...row,
                amount: Number(row.amount),
                metadata: row.metadata ?? {},
            }));
        });
    }

    async listProgramEvents(
        salonId: string,
        limit: number,
        offset: number
    ): Promise<LoyaltyProgramEvent[]> {
        const result = await db.query<{
            id: string;
            eventType: LoyaltyProgramEvent['eventType'];
            beforeState: Record<string, unknown> | null;
            afterState: Record<string, unknown>;
            actorAccountId: string;
            createdAt: Date;
        }>(
            `SELECT id, event_type AS "eventType",
                    before_state AS "beforeState", after_state AS "afterState",
                    actor_account_id AS "actorAccountId", created_at AS "createdAt"
             FROM salon_loyalty_program_events
             WHERE salon_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [salonId, limit, offset]
        );
        return result.rows;
    }

    async getAvailableRedemptionValue(
        client: PoolClient,
        customerAccountId: string,
        salonId: string
    ): Promise<number> {
        await this.lockProgram(client, salonId);
        const program = await this.loadProgram(client, salonId);
        if (!program || !this.canRedeem(program)) return 0;
        await this.expireDuePoints(client, customerAccountId, salonId);
        const lots = await this.readPointLots(client, customerAccountId, salonId, false);
        const balance = roundPoints(lots.reduce((sum, lot) => sum + lot.remaining, 0));
        return roundMoney(balance / program.pointConversionRate);
    }

    async redeemForPos(
        client: PoolClient,
        customerAccountId: string,
        salonId: string,
        billId: string,
        redemptionAmount: number,
        idempotencyKey: string
    ): Promise<number> {
        await this.lockWallet(client, customerAccountId, salonId);
        const replay = await client.query<{ amount: string; metadata: Record<string, unknown> }>(
            `SELECT amount::text AS amount, metadata
             FROM customer_loyalty_ledger
             WHERE salon_id = $1 AND idempotency_key = $2`,
            [salonId, idempotencyKey]
        );
        if (replay.rowCount) {
            if (Number(replay.rows[0].metadata.redemptionAmount) !== redemptionAmount) {
                throw new ApiError(409, 'Idempotency key was used for a different loyalty redemption');
            }
            return Math.abs(Number(replay.rows[0].amount));
        }

        await this.lockProgram(client, salonId);
        const program = await this.loadProgram(client, salonId);
        if (!program || !this.canRedeem(program)) {
            throw new ApiError(409, 'The salon loyalty program is not available for redemption');
        }
        await this.expireDuePoints(client, customerAccountId, salonId);
        const requiredPoints = roundPoints(redemptionAmount * program.pointConversionRate);
        const lots = await this.readPointLots(client, customerAccountId, salonId, false);
        let allocations: Array<{ lotId: string; points: number }>;
        try {
            allocations = allocatePointsFifo(lots, requiredPoints);
        } catch (error) {
            if (error instanceof InsufficientPointsError) {
                throw new ApiError(409, 'Loyalty point balance is insufficient or reserved');
            }
            throw error;
        }

        const ledgerId = randomUUID();
        await client.query(
            `INSERT INTO customer_loyalty_ledger (
                id, customer_account_id, salon_id, amount, transaction_reference,
                entry_type, idempotency_key, metadata
             ) VALUES ($1, $2, $3, $4, $5, 'REDEEMED', $6, $7::jsonb)`,
            [
                ledgerId,
                customerAccountId,
                salonId,
                -requiredPoints,
                billId,
                idempotencyKey,
                JSON.stringify({ billId, redemptionAmount, pointConversionRate: program.pointConversionRate }),
            ]
        );
        for (const allocation of allocations) {
            await client.query(
                `INSERT INTO customer_loyalty_lot_allocations (
                    ledger_entry_id, earning_entry_id, points_amount
                 ) VALUES ($1, $2, $3)`,
                [ledgerId, allocation.lotId, allocation.points]
            );
        }
        return requiredPoints;
    }

    async reversePointsForRefund(salonId: string, billId: string, refundId: string) {
        return this.withTransaction(async (client) => {
            const bill = await client.query<{
                customerAccountId: string;
                totalAmount: string;
            }>(
                `SELECT session.customer_account_id AS "customerAccountId",
                        bill.total_amount::text AS "totalAmount"
                 FROM pos_bills AS bill
                 JOIN pos_billing_sessions AS session
                   ON session.id = bill.session_id AND session.salon_id = bill.salon_id
                 WHERE bill.id = $1 AND bill.salon_id = $2`,
                [billId, salonId]
            );
            if (!bill.rowCount) throw new ApiError(404, 'POS bill was not found');
            if (Number(bill.rows[0].totalAmount) <= 0) return { pointsReversed: 0 };
            await this.lockWallet(client, bill.rows[0].customerAccountId, salonId);
            const earning = await client.query<{
                id: string;
                amount: string;
                metadata: Record<string, unknown>;
            }>(
                `SELECT id, amount::text AS amount, metadata
                 FROM customer_loyalty_ledger
                 WHERE salon_id = $1 AND transaction_reference = $2
                   AND entry_type = 'EARNED'`,
                [salonId, billId]
            );
            if (!earning.rowCount) return { pointsReversed: 0 };

            const refund = await client.query<{ amount: string }>(
                `SELECT amount::text AS amount
                 FROM pos_refunds
                 WHERE id = $1 AND salon_id = $2
                   AND bill_id = $3 AND status = 'COMPLETED'`,
                [refundId, salonId, billId]
            );
            if (!refund.rowCount) throw new ApiError(409, 'Completed refund was not found');
            const grossPointsEarned = Number(
                earning.rows[0].metadata.grossPointsEarned ?? earning.rows[0].amount
            );
            const prior = await client.query<{ amount: string }>(
                `SELECT COALESCE(SUM(-amount), 0)::text AS amount
                 FROM customer_loyalty_ledger
                 WHERE salon_id = $1 AND transaction_reference = $2
                   AND entry_type = 'REVERSAL'
                   AND metadata->>'refundId' = $3`,
                [salonId, billId, refundId]
            );
            const reversalNeeded = calculateRefundReversal(
                grossPointsEarned,
                Number(refund.rows[0].amount),
                Number(bill.rows[0].totalAmount),
                Number(prior.rows[0].amount)
            );
            if (reversalNeeded <= 0) return { pointsReversed: 0 };

            const lot = await client.query<{ remaining: string }>(
                `SELECT earned.amount - COALESCE(SUM(allocation.points_amount), 0) AS remaining
                 FROM customer_loyalty_ledger AS earned
                 LEFT JOIN customer_loyalty_lot_allocations AS allocation
                   ON allocation.earning_entry_id = earned.id
                 WHERE earned.id = $1
                 GROUP BY earned.id, earned.amount`,
                [earning.rows[0].id]
            );
            const pointsReversed = roundPoints(Math.min(reversalNeeded, Number(lot.rows[0]?.remaining ?? 0)));
            if (pointsReversed <= 0) return { pointsReversed: 0 };

            const ledgerId = randomUUID();
            const inserted = await client.query<{ id: string }>(
                `INSERT INTO customer_loyalty_ledger (
                    id, customer_account_id, salon_id, amount, transaction_reference,
                    entry_type, idempotency_key, metadata
                 ) VALUES ($1, $2, $3, $4, $5, 'REVERSAL', $6, $7::jsonb)
                 ON CONFLICT (salon_id, idempotency_key)
                 DO NOTHING
                 RETURNING id`,
                [
                    ledgerId,
                    bill.rows[0].customerAccountId,
                    salonId,
                    -pointsReversed,
                    billId,
                    `refund-loyalty-reversal:${refundId}`,
                    JSON.stringify({ billId, refundId, pointsReversed }),
                ]
            );
            if (!inserted.rowCount) return { pointsReversed: 0, duplicate: true };
            await client.query(
                `INSERT INTO customer_loyalty_lot_allocations (
                    ledger_entry_id, earning_entry_id, points_amount
                 ) VALUES ($1, $2, $3)`,
                [ledgerId, earning.rows[0].id, pointsReversed]
            );
            return { pointsReversed };
        });
    }

    private async buildPreview(
        client: PoolClient,
        salonId: string,
        billId: string,
        program: LoyaltyProgramSettings | null
    ): Promise<LoyaltyPreview> {
        if (!program) {
            return {
                salonId,
                billId,
                isActive: false,
                eligibleCategories: [],
                qualifyingSpend: 0,
                minimumSpend: 0,
                pointsEarned: 0,
                redemptionValue: 0,
                meetsMinimumSpend: false,
            };
        }

        const totals = await client.query<BillItemTotal>(
            `SELECT item_type AS category,
                    SUM(GREATEST(subtotal - discount_amount, 0))::text AS "qualifyingSpend"
             FROM pos_bill_items
             WHERE bill_id = $1 AND salon_id = $2
               AND removed_at IS NULL AND is_covered_by_plan = FALSE
             GROUP BY item_type`,
            [billId, salonId]
        );
        const qualifyingSpend = calculateQualifyingSpend(
            totals.rows.map((row) => ({
                category: row.category,
                amount: Number(row.qualifyingSpend),
            })),
            program.eligibleCategories
        );
        const isActive = program.isActive;
        const pointsEarned = isActive
            ? calculatePointsAward(
                qualifyingSpend,
                program.minimumSpend,
                program.rewardPercentage,
                program.pointConversionRate
            )
            : 0;
        return {
            salonId,
            billId,
            isActive,
            eligibleCategories: program.eligibleCategories,
            qualifyingSpend,
            minimumSpend: program.minimumSpend,
            pointsEarned,
            redemptionValue: roundMoney(pointsEarned / program.pointConversionRate),
            meetsMinimumSpend: qualifyingSpend >= program.minimumSpend,
        };
    }

    private async loadProgram(
        client: PoolClient,
        salonId: string
    ): Promise<LoyaltyProgramSettings | null> {
        const result = await client.query<ProgramRow>(
            `SELECT program.salon_id AS "salonId",
                    program.minimum_spend::text AS "minimumSpend",
                    program.reward_percentage::text AS "rewardPercentage",
                    program.point_conversion_rate::text AS "pointConversionRate",
                    program.points_expiry_days AS "pointsExpiryDays",
                    program.is_active AS "isActive",
                    program.closed_at AS "closedAt",
                    program.redeem_until AS "redeemUntil",
                    program.expiry_locked_at AS "expiryLockedAt",
                    program.created_at AS "createdAt",
                    program.updated_at AS "updatedAt",
                    COALESCE(
                        ARRAY_AGG(category.category)
                            FILTER (WHERE category.is_eligible = TRUE),
                        ARRAY[]::text[]
                    ) AS "eligibleCategories"
             FROM salon_loyalty_programs AS program
             LEFT JOIN salon_loyalty_eligible_categories AS category
               ON category.salon_id = program.salon_id
             WHERE program.salon_id = $1
             GROUP BY program.salon_id`,
            [salonId]
        );
        return result.rows[0] ? this.mapProgram(result.rows[0]) : null;
    }

    private mapProgram(row: ProgramRow): LoyaltyProgramSettings {
        return {
            salonId: row.salonId,
            minimumSpend: Number(row.minimumSpend),
            rewardPercentage: Number(row.rewardPercentage),
            pointConversionRate: Number(row.pointConversionRate),
            pointsExpiryDays: row.pointsExpiryDays,
            eligibleCategories: row.eligibleCategories ?? [],
            isActive: row.isActive,
            closedAt: row.closedAt,
            redeemUntil: row.redeemUntil,
            expiryLockedAt: row.expiryLockedAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    private async readPointLots(
        client: PoolClient,
        customerAccountId: string,
        salonId: string,
        includeExpired: boolean
    ): Promise<PointsLot[]> {
        const result = await client.query<{
            id: string;
            remaining: string;
            lotExpiresAt: Date;
            redeemUntil: Date | null;
        }>(
            `SELECT earned.id,
                    (earned.amount - COALESCE(SUM(allocation.points_amount), 0))::text AS remaining,
                    earned.expires_at AS "lotExpiresAt",
                    program.redeem_until AS "redeemUntil"
             FROM customer_loyalty_ledger AS earned
             JOIN salon_loyalty_programs AS program ON program.salon_id = earned.salon_id
             LEFT JOIN customer_loyalty_lot_allocations AS allocation
               ON allocation.earning_entry_id = earned.id
             WHERE earned.customer_account_id = $1 AND earned.salon_id = $2
               AND earned.entry_type = 'EARNED'
             GROUP BY earned.id, earned.amount, earned.expires_at, earned.created_at, program.redeem_until
             HAVING earned.amount - COALESCE(SUM(allocation.points_amount), 0) > 0
             ORDER BY LEAST(
                    earned.expires_at,
                    COALESCE(program.redeem_until, earned.expires_at)
                ) ASC, earned.created_at ASC, earned.id ASC`,
            [customerAccountId, salonId]
        );
        const now = new Date();
        return result.rows.flatMap((row) => {
            const expiresAt = calculateEffectiveExpiry(row.lotExpiresAt, row.redeemUntil);
            if (!includeExpired && expiresAt <= now) return [];
            return [{ id: row.id, remaining: Number(row.remaining), expiresAt }];
        });
    }

    private async expireDuePoints(
        client: PoolClient,
        customerAccountId: string,
        salonId: string
    ) {
        const lots = await this.readPointLots(client, customerAccountId, salonId, true);
        const now = Date.now();
        for (const lot of lots) {
            if (lot.expiresAt.getTime() > now) continue;
            const ledgerId = randomUUID();
            const inserted = await client.query<{ id: string }>(
                `INSERT INTO customer_loyalty_ledger (
                    id, customer_account_id, salon_id, amount, transaction_reference,
                    expires_at, entry_type, idempotency_key, metadata
                 )
                 SELECT $1, $2, $3, $4, earned.transaction_reference,
                        $5, 'EXPIRED', $6, $7::jsonb
                 FROM customer_loyalty_ledger AS earned
                 WHERE earned.id = $8
                 ON CONFLICT (salon_id, idempotency_key)
                 DO NOTHING
                 RETURNING id`,
                [
                    ledgerId,
                    customerAccountId,
                    salonId,
                    -lot.remaining,
                    lot.expiresAt,
                    `loyalty-expiry:${lot.id}`,
                    JSON.stringify({ earningEntryId: lot.id, pointsExpired: lot.remaining }),
                    lot.id,
                ]
            );
            if (!inserted.rowCount) continue;
            await client.query(
                `INSERT INTO customer_loyalty_lot_allocations (
                    ledger_entry_id, earning_entry_id, points_amount
                 ) VALUES ($1, $2, $3)`,
                [ledgerId, lot.id, lot.remaining]
            );
        }
    }

    private canRedeem(program: ProgramState): boolean {
        return program.isActive || Boolean(program.closedAt && program.redeemUntil && program.redeemUntil > new Date());
    }

    private async lockWallet(client: PoolClient, customerAccountId: string, salonId: string) {
        await client.query(
            `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [`${customerAccountId}:${salonId}:pos-wallet`]
        );
    }

    private async lockProgram(client: PoolClient, salonId: string) {
        await client.query(
            `SELECT salon_id
             FROM salon_loyalty_programs
             WHERE salon_id = $1
             FOR SHARE`,
            [salonId]
        );
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
