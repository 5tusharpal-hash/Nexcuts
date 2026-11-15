export interface LedgerEntry {
    id: string;
    date: Date;
    type: 'SERVICE' | 'LOYALTY' | 'PAYMENT' | 'REFUND';
    category: 'WALK_IN' | 'APPOINTMENT' | 'GROUP_BOOKING' | 'REWARD';
    description: string;
    amount?: number;
    paymentSource?: 'CASH' | 'POINTS' | 'PACKAGE' | 'COMBO' | 'ONLINE' | 'CREDIT';
    billId?: string;
    bookingId?: string;
    status: 'COMPLETED' | 'PENDING' | 'CANCELLED';
}

export interface CustomerLedgerResponse {
    userId: string;
    timeline: LedgerEntry[];
    pagination: {
        limit: number;
        offset: number;
        total: number;
    };
    summary: {
        totalSpent: number;
        totalPointsEarned: number;
        totalServicesTaken: number;
    };
}

export interface CustomerLedgerQuery {
    limit: number;
    offset: number;
}
