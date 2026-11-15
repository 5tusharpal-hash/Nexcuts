import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsReport } from './analytics.types';
import { ApiError } from '../../shared/errors/ApiError.js';

export class AnalyticsService {
    constructor(private repository: AnalyticsRepository) {}

    /**
     * Generates a comprehensive business health report for a specific salon branch
     */
    async generateBranchReport(branchId: string, startDate: Date, endDate: Date): Promise<AnalyticsReport> {
        // Run all analytics in parallel for performance
        const [revenue, operations, customers, staff] = await Promise.all([
            this.repository.getRevenueStats(branchId, startDate, endDate),
            this.repository.getOperationalStats(branchId, startDate, endDate),
            this.repository.getCustomerInsights(branchId),
            this.repository.getStaffPerformance(branchId)
        ]);

        return {
            revenue,
            operations,
            customers,
            staff
        };
    }

    /**
     * Identifies "At-Risk" customers (Churn analysis)
     * Customers who haven't visited in their usual frequency
     */
    async getChurnAlerts(branchId: string, limit: number, offset: number) {
        if (!branchId) throw new ApiError(400, 'Salon ID is required');
        return this.repository.getChurnAlerts(branchId, limit, offset);
    }
}
