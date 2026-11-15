import type { PaymentProvider } from '../../integrations/payments/platform-payment-gateway.js';

export interface PlatformSubscription {
    id: string;
    organizationId: string;
    salonId: string;
    planId: string;
    planType: string;
    status: string;
    startDate: Date;
    endDate: Date;
    monthlyFee: number;
}

export interface PlatformConsolidatedCheckoutRequest {
    invoiceIds: string[];
    provider: PaymentProvider;
}

export interface PlatformCheckoutAllocation {
    invoiceId: string;
    invoiceNumber: string;
    salonId: string;
    amount: number;
}

export interface PlatformConsolidatedCheckoutResponse {
    provider: PaymentProvider;
    paymentId: string;
    organizationId: string;
    invoiceId: string;
    invoiceNumber: string;
    invoiceIds: string[];
    invoiceNumbers: string[];
    allocations: PlatformCheckoutAllocation[];
    amount: number;
    currency: 'INR';
    checkoutUrl?: string | null;
    sessionId?: string;
    keyId?: string;
    orderId?: string;
    amountMinor?: number;
    expiresAt?: Date;
}

export interface PlatformAddonPurchaseRequest {
    activationMode: 'IMMEDIATE_PRORATED' | 'NEXT_CYCLE';
    provider?: PaymentProvider;
}

export interface PlatformAddonPurchaseResponse {
    purchaseId: string;
    salonId: string;
    addonId: string;
    activationMode: 'IMMEDIATE_PRORATED' | 'NEXT_CYCLE';
    status: 'SCHEDULED' | 'PENDING_PAYMENT' | 'ACTIVE' | 'CANCELLED';
    amount: number;
    effectiveAt: string;
    invoiceId?: string | null;
    checkout?: PlatformConsolidatedCheckoutResponse;
}

export interface B2BInvoice {
    id: string;
    organizationId: string;
    salonId: string;
    invoiceNumber: string;
    invoiceKind?: 'SUBSCRIPTION' | 'ADDON_ADJUSTMENT';
    amount: number;
    billingPeriodStart: Date;
    billingPeriodEnd: Date;
    status: string;
    createdAt: Date;
    paidAt?: Date;
    subtotal?: number;
    taxAmount?: number;
    taxType?: 'NONE' | 'CGST_SGST' | 'IGST';
    cgstAmount?: number;
    sgstAmount?: number;
    igstAmount?: number;
    buyerGstin?: string | null;
    sellerGstin?: string | null;
    sellerStateCode?: string | null;
    buyerStateCode?: string | null;
    currency?: string;
}

export interface PlatformUsageStats {
    salonId: string;
    totalBookings: number;
    activeUsers: number;
    revenueGenerated: number;
}
