import { CustomerLedgerRepository } from './customer_ledger.repository';
import { CustomerLedgerResponse } from './customer_ledger.types';
import { ApiError } from '../../shared/errors/ApiError.js';

export class CustomerLedgerService {
    constructor(private repository: CustomerLedgerRepository) {}

    async getCustomerTimeline(userId: string, limit: number, offset: number): Promise<CustomerLedgerResponse> {
        const [timeline, summary, total] = await Promise.all([
            this.repository.getUnifiedTimeline(userId, limit, offset),
            this.repository.getTimelineSummary(userId),
            this.repository.getTimelineCount(userId),
        ]);

        return {
            userId,
            timeline,
            pagination: { limit, offset, total },
            summary,
        };
    }

    async getBillDetails(billId: string, userId: string) {
        const details = await this.repository.getBillDetails(billId, userId);
        if (!details) throw new ApiError(404, 'Bill not found');
        return details;
    }
}
