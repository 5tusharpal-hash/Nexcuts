export const LOYALTY_CATEGORIES = ['SERVICE', 'PRODUCT', 'PACKAGE', 'COMBO'] as const;

export type LoyaltyCategory = (typeof LOYALTY_CATEGORIES)[number];

export type LoyaltyEntryType = 'EARNED' | 'REDEEMED' | 'EXPIRED' | 'REVERSAL';

export interface LoyaltyProgramSettings {
    salonId: string;
    minimumSpend: number;
    rewardPercentage: number;
    pointConversionRate: number;
    pointsExpiryDays: number;
    eligibleCategories: LoyaltyCategory[];
    isActive: boolean;
    closedAt: Date | null;
    redeemUntil: Date | null;
    expiryLockedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface UpdateLoyaltyProgramRequest {
    minimumSpend: number;
    rewardPercentage: number;
    pointConversionRate: number;
    pointsExpiryDays: number;
    eligibleCategories: LoyaltyCategory[];
    isActive: boolean;
}

export interface LoyaltyPreview {
    salonId: string;
    billId: string;
    isActive: boolean;
    eligibleCategories: LoyaltyCategory[];
    qualifyingSpend: number;
    minimumSpend: number;
    pointsEarned: number;
    redemptionValue: number;
    meetsMinimumSpend: boolean;
}

export interface LoyaltyWallet {
    salonId: string;
    customerAccountId: string;
    pointsBalance: number;
    redemptionValue: number;
    pointConversionRate: number;
    expiresAt: Date | null;
    redeemUntil: Date | null;
    expiringPoints: Array<{
        points: number;
        expiresAt: Date;
    }>;
}

export interface LoyaltyLedgerEntry {
    id: string;
    amount: number;
    entryType: LoyaltyEntryType;
    transactionReference: string | null;
    expiresAt: Date | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
}

export interface LoyaltyProgramEvent {
    id: string;
    eventType: 'CREATED' | 'UPDATED' | 'CLOSED';
    beforeState: Record<string, unknown> | null;
    afterState: Record<string, unknown>;
    actorAccountId: string;
    createdAt: Date;
}

export interface LoyaltyListQuery {
    limit: number;
    offset: number;
}

export interface PointsLot {
    id: string;
    remaining: number;
    expiresAt: Date;
}
