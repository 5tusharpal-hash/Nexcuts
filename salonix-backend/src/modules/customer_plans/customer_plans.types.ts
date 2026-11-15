export interface CustomerPlan {
    id: string;
    userId: string;
    planId: string;
    salonId: string;
    status: 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED';
    usageData: Record<string, number>; // serviceId: usedCount
    purchaseDate: Date;
    expiryDate: Date;
}

export interface PlanUsageRequest {
    userId: string;
    salonId: string;
    serviceId: string;
}
