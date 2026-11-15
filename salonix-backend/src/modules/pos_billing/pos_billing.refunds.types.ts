export interface CreditNote {
    id: string;
    billId: string;
    userId: string;
    salonId: string;
    amount: number;
    reason: 'SERVICE_ISSUE' | 'BRANCH_PAUSE' | 'CUSTOMER_REQUEST' | 'ERROR';
    status: 'ISSUED' | 'REDEEMED' | 'EXPIRED';
    expiryDate?: Date;
    createdAt: Date;
}

export interface UserCredit {
    userId: string;
    salonId: string;
    balance: number;
    updatedAt: Date;
}

export interface RefundRequest {
    billId: string;
    amount: number;
    reason: CreditNote['reason'];
}
