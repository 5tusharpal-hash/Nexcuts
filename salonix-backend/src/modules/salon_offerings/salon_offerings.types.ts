export type OfferStatus = 'DRAFT' | 'UNLISTED' | 'LISTED' | 'ARCHIVED';
export type OfferType = 'PACKAGE' | 'COMBO';
export type PurchaseRequestStatus =
    | 'PENDING'
    | 'BILLING'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'CANCELLED';
export type OfferPaymentMode = 'CASH' | 'UPI' | 'CARD' | 'OTHER';

export interface PackageServiceInput {
    serviceId: string;
    maxUses?: number;
}

export interface CreatePackageRequest {
    name: string;
    description?: string | null;
    sellingPrice: string;
    creditAmount: string;
    validityDays: number;
    services: PackageServiceInput[];
    status: OfferStatus;
}

export interface UpdatePackageRequest {
    name?: string;
    description?: string | null;
    sellingPrice?: string;
    creditAmount?: string;
    validityDays?: number;
    services?: PackageServiceInput[];
    status?: OfferStatus;
}

export interface CreateComboRequest {
    name: string;
    description?: string | null;
    sellingPrice: string;
    validityDays: number;
    serviceIds: string[];
    status: OfferStatus;
}

export interface UpdateComboRequest {
    name?: string;
    description?: string | null;
    sellingPrice?: string;
    validityDays?: number;
    serviceIds?: string[];
    status?: OfferStatus;
}

export interface OfferServiceSnapshot {
    serviceId: string;
    serviceName: string;
    servicePriceAtRevision: string;
    estimatedDurationMinutes: number;
    maxUses?: number;
}

export interface SalonOffering {
    id: string;
    salonId: string;
    name: string;
    description: string | null;
    type: OfferType;
    sellingPrice: string;
    creditAmount?: string;
    validityDays: number;
    status: OfferStatus;
    revisionNumber: number;
    services: OfferServiceSnapshot[];
    createdAt: Date;
    updatedAt: Date;
}

export interface ListOfferingsQuery {
    limit: number;
    offset: number;
    type?: OfferType;
}

export interface CreatePurchaseRequest {
    offerType: OfferType;
    offeringId: string;
    paymentMode?: OfferPaymentMode;
}

export interface CreateManualOfferSaleRequest extends CreatePurchaseRequest {
    customerPhone: string;
    finalAmount: string;
    discountReason?: string;
    paymentMode?: OfferPaymentMode;
    idempotencyKey: string;
}

export interface UpdateOfferSaleQuoteRequest {
    finalAmount: string;
    discountReason?: string;
}

export interface RejectOfferPurchaseRequest {
    reason: string;
}

export interface ConfirmOfferSettlementRequest {
    billId: string;
    idempotencyKey: string;
}

export interface AttachOfferBillRequest {
    billId: string;
}

export interface RedeemPackageRequest {
    serviceId: string;
    billId: string;
    idempotencyKey: string;
}

export interface RedeemComboRequest {
    serviceIds: string[];
    billId: string;
    idempotencyKey: string;
}

export interface OfferPurchaseRequestResponse {
    id: string;
    salonId: string;
    customerAccountId: string;
    offerType: OfferType;
    offeringId: string;
    status: PurchaseRequestStatus;
    paymentMode: OfferPaymentMode | null;
    listPrice: string;
    finalAmount: string;
    discountAmount: string;
    discountReason: string | null;
    termsSnapshot: Record<string, unknown>;
    servicesSnapshot: OfferServiceSnapshot[];
    isManualAssignment: boolean;
    billId: string | null;
    rejectionReason: string | null;
    createdAt: Date;
    acceptedAt: Date | null;
}

export interface CustomerOfferPurchaseResponse {
    request: OfferPurchaseRequestResponse;
    entitlementId: string | null;
    remainingCredit: string | null;
    status: string;
    expiresAt: Date | null;
}

export interface OfferLedgerEntry {
    id: string;
    purchaseRequestId: string;
    entryType: string;
    amount: string;
    serviceId: string | null;
    billId: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
}
