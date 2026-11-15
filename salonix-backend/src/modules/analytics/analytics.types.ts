export interface RevenueStats {
    totalRevenue: number;
    serviceRevenue: number;
    productRevenue: number;
    averageTicketValue: number;
    growthPercentage: number;
}

export interface OperationalStats {
    stylistUtilizationRate: number; // percentage
}

export interface CustomerInsights {
    retentionRate: number; // percentage
    vipCustomerCount: number;
    churnRate: number;
    topCustomers: Array<{ customerId: string, totalSpend: number }>;
}

export interface StaffPerformance {
    stylistId: string;
    totalRevenue: number;
    repeatCustomerCount: number;
    efficiencyScore: number;
    averageRating: number;
}

export interface AnalyticsReport {
    revenue: RevenueStats;
    operations: OperationalStats;
    customers: CustomerInsights;
    staff: StaffPerformance[];
}

export interface ChurnAlert {
    customerId: string;
    lastVisitAt: Date;
    usualVisitIntervalDays: number;
    overdueDays: number;
}

export interface BranchAnalyticsQuery {
    startDate: Date;
    endDate: Date;
}

export interface ChurnAlertQuery {
    limit: number;
    offset: number;
}
