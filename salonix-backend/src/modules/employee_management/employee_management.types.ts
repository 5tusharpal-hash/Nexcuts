export interface DateRangeQuery {
    from: string;
    to: string;
    limit: number;
    offset: number;
}

export interface EmployeeManagementResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        message: string;
        code: string;
    };
}

export interface CreateHolidayRequest {
    date: string;
    name: string;
    isPaid: boolean;
    note?: string;
}

export interface CreateLeaveTypeRequest {
    name: string;
    isPaid: boolean;
    deductsBalance: boolean;
    isEmergency: boolean;
}

export interface CreateLeaveRequest {
    leaveTypeId: string;
    startsOn: string;
    endsOn: string;
    requestedDays: number;
    reason: string;
}

export interface ReviewLeaveRequest {
    status: 'APPROVED' | 'REJECTED';
    note?: string;
}

export interface CreateLeaveLedgerEntryRequest {
    leaveTypeId: string;
    daysChange: number;
    note: string;
}

export interface CreateServiceWorkRequest {
    membershipId: string;
    serviceId: string;
    sourceType: 'QUEUE' | 'POS';
    sourceId: string;
}

export interface CreateTipRequest {
    billId: string;
    membershipId: string;
    amount: number;
    idempotencyKey: string;
}

export interface ReviewTipRequest {
    status: 'APPROVED' | 'REJECTED';
    note?: string;
}

export interface CreateTipRefundRequest {
    tipRequestId: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
}

export interface ReviewTipRefundRequest {
    status: 'APPROVED' | 'REJECTED';
    note?: string;
}

export interface CompleteTipRefundRequest {
    payoutReference?: string;
    note: string;
}

export interface TipRefundRequestResponse {
    id: string;
    tipRequestId: string;
    amount: number;
    reason: string;
    source: 'CUSTOMER' | 'DESK';
    status: 'PENDING' | 'PAYOUT_PENDING' | 'REJECTED' | 'COMPLETED';
    createdAt: string | Date;
}

export interface TipRefundListItemResponse extends TipRefundRequestResponse {
    billId: string;
    membershipId: string;
    staffName: string;
    customerAccountId: string;
    reviewNote: string | null;
    payoutReference: string | null;
    completionNote: string | null;
    reviewedAt: string | Date | null;
    completedAt: string | Date | null;
}

export interface TipRefundStatusResponse {
    id: string;
    status: 'PAYOUT_PENDING' | 'REJECTED';
    reviewedAt: string | Date;
}

export interface TipRefundCompletionResponse {
    id: string;
    tipRequestId: string;
    amount: number;
    status: 'COMPLETED';
    payoutReference: string | null;
    completedAt: string | Date;
}
