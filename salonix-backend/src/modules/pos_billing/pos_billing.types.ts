export interface BillRequest {
    bookingId?: string;
    comboPurchaseId?: string;
    paymentMethod: 'CASH' | 'ONLINE' | 'POINTS' | 'PACKAGE' | 'COMBO';
    amountPaid: number;
}

export interface BillResponse {
    id: string;
    totalAmount: number;
    paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
    createdAt: Date;
}

export interface BillItem {
    serviceId?: string;
    productId?: string;
    staffMembershipId?: string;
    quantity: number;
    price?: number;
}

export type PosSaleOrigin = 'QUEUE' | 'WALK_IN' | 'OFFLINE_SALE';
export type PosTenderMode = 'CASH' | 'UPI' | 'CARD' | 'OTHER';
export type PosBillItemType = 'SERVICE' | 'PRODUCT' | 'PACKAGE' | 'COMBO';
export type PosDiscountType = 'PERCENT' | 'FIXED';

export interface CreatePosSessionRequest {
    customerAccountId: string;
    bookingId?: string;
    queueEntryId?: string;
    origin: PosSaleOrigin;
}

export type PosTaxCategory = 'SERVICE' | 'PRODUCT' | 'PACKAGE' | 'COMBO' | 'CONSUMABLE';

export interface PosCategorySettingRequest {
    taxMode: 'INCLUSIVE' | 'EXCLUSIVE';
    allowPackage: boolean;
    allowCombo: boolean;
    allowLoyalty: boolean;
    reason: string;
}

export interface PosBillCategoryOverrideRequest {
    allowPackage: boolean;
    allowCombo: boolean;
    allowLoyalty: boolean;
    reason: string;
}

interface PosBillItemBase {
    quantity: number;
    description?: string;
    discountType?: PosDiscountType;
    discountValue?: number;
    taxRate?: number;
    taxInclusive?: boolean;
    taxOverrideReason?: string;
    staffMembershipId?: string;
    parentBillItemId?: string;
}

export interface PosServiceLineRequest extends PosBillItemBase {
    itemType: 'SERVICE';
    serviceId: string;
}

export interface PosProductLineRequest extends PosBillItemBase {
    itemType: 'PRODUCT';
    productId: string;
    batchAllocations: Array<{
        batchId: string;
        quantity: number;
        expiredOverrideReason?: string;
    }>;
}

export interface PosOfferLineRequest extends PosBillItemBase {
    itemType: 'PACKAGE' | 'COMBO';
    offerPurchaseRequestId: string;
}

export type PosBillLineRequest =
    | PosServiceLineRequest
    | PosProductLineRequest
    | PosOfferLineRequest;

export interface CreatePosBillRequest {
    items: PosBillLineRequest[];
}

export interface UpdatePosBillRequest {
    items: PosBillLineRequest[];
}

export interface RecordPosPaymentRequest {
    paymentMode: PosTenderMode;
    amount: number;
    transactionReference?: string;
    idempotencyKey: string;
}

export interface CreatePaymentClaimRequest {
    billId: string;
    billVersionId: string;
    paymentMode: PosTenderMode;
    amount: number;
    transactionReference?: string;
    idempotencyKey: string;
}

export interface CreateAdvanceClaimRequest {
    paymentMode: PosTenderMode;
    amount: number;
    transactionReference?: string;
    idempotencyKey: string;
}

export interface AllocateAdvanceRequest {
    advanceEntryId: string;
    billId: string;
    amount: number;
    idempotencyKey: string;
}

export interface ReviewPaymentClaimRequest {
    status: 'APPROVED' | 'REJECTED';
    reason?: string;
}

export interface IssueBillVersionRequest {
    customerMessage?: string;
}

export interface ConfirmPosBillRequest {
    versionId: string;
}

export interface CreatePosWalletRedemptionRequest {
    billId: string;
    versionId: string;
    allocations: Array<{
        type: 'PACKAGE' | 'COMBO' | 'LOYALTY';
        entitlementId?: string;
        billItemId?: string;
        amount: number;
        serviceId?: string;
    }>;
    idempotencyKey: string;
}

export interface VerifyPosWalletRedemptionRequest {
    redemptionId: string;
    code: string;
}

export interface ReviewPosWalletRedemptionRequest {
    status: 'APPROVED' | 'REJECTED';
    reason?: string;
}

export interface CreatePosRefundRequest {
    amount: number;
    reason: 'SERVICE_ISSUE' | 'BRANCH_PAUSE' | 'CUSTOMER_REQUEST' | 'ERROR';
    paymentId?: string;
    idempotencyKey: string;
}

export interface ReviewPosRefundRequest {
    status: 'COMPLETED' | 'CANCELLED';
    reason?: string;
    cashPayoutConfirmed?: boolean;
    payoutReference?: string;
}

export interface PosBillResponse {
    id: string;
    sessionId: string;
    salonId: string;
    invoiceNumber: string;
    workflowStatus: string;
    currentVersion: number;
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    totalAmount: number;
    paidAmount: number;
    balanceDue: number;
    items: Array<Record<string, unknown>>;
}
