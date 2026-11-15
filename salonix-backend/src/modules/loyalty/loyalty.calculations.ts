import type { PointsLot } from './loyalty.types.js';

export class InsufficientPointsError extends Error {
    constructor() {
        super('Insufficient loyalty points');
        this.name = 'InsufficientPointsError';
    }
}

export const roundPoints = (value: number): number =>
    Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateQualifyingSpend(
    categoryTotals: Array<{ category: string; amount: number }>,
    eligibleCategories: readonly string[]
): number {
    const eligible = new Set(eligibleCategories);
    const total = categoryTotals.reduce(
        (sum, item) => eligible.has(item.category) ? sum + item.amount : sum,
        0
    );
    return roundPoints(total);
}

export function calculatePointsAward(
    qualifyingSpend: number,
    minimumSpend: number,
    rewardPercentage: number,
    pointConversionRate: number
): number {
    if (qualifyingSpend < minimumSpend) return 0;
    return roundPoints(qualifyingSpend * (rewardPercentage / 100) * pointConversionRate);
}

export function calculateRefundReversal(
    grossPointsEarned: number,
    refundAmount: number,
    billTotal: number,
    pointsAlreadyReversed: number
): number {
    if (billTotal <= 0) return 0;
    const targetReversal = roundPoints(
        grossPointsEarned * Math.min(refundAmount, billTotal) / billTotal
    );
    return Math.max(0, roundPoints(targetReversal - pointsAlreadyReversed));
}

export function calculateEffectiveExpiry(
    lotExpiresAt: Date,
    redeemUntil: Date | null
): Date {
    if (!redeemUntil || lotExpiresAt <= redeemUntil) return lotExpiresAt;
    return redeemUntil;
}

export function allocatePointsFifo(
    lots: PointsLot[],
    requestedPoints: number
): Array<{ lotId: string; points: number }> {
    let remaining = roundPoints(requestedPoints);
    const allocations: Array<{ lotId: string; points: number }> = [];

    for (const lot of lots) {
        if (remaining <= 0) break;
        const points = roundPoints(Math.min(lot.remaining, remaining));
        if (points <= 0) continue;
        allocations.push({ lotId: lot.id, points });
        remaining = roundPoints(remaining - points);
    }

    if (remaining > 0) throw new InsufficientPointsError();
    return allocations;
}
