import { LoyaltyRepository } from './loyalty.repository.js';
import type { UpdateLoyaltyProgramRequest } from './loyalty.types.js';

export class LoyaltyService {
    constructor(private readonly repository: LoyaltyRepository) {}

    getProgram(salonId: string) {
        return this.repository.getProgram(salonId);
    }

    updateProgram(
        salonId: string,
        actorAccountId: string,
        input: UpdateLoyaltyProgramRequest
    ) {
        return this.repository.updateProgram(salonId, actorAccountId, input);
    }

    getPublicProgram(salonId: string) {
        return this.repository.getPublicProgram(salonId);
    }

    getCustomerWallet(customerAccountId: string, salonId: string) {
        return this.repository.getCustomerWallet(customerAccountId, salonId);
    }

    listCustomerLedger(
        customerAccountId: string,
        salonId: string,
        limit: number,
        offset: number
    ) {
        return this.repository.listCustomerLedger(customerAccountId, salonId, limit, offset);
    }

    listProgramEvents(salonId: string, limit: number, offset: number) {
        return this.repository.listProgramEvents(salonId, limit, offset);
    }

    previewBill(salonId: string, billId: string) {
        return this.repository.previewBill(salonId, billId);
    }

    awardForSettledBill(salonId: string, billId: string) {
        return this.repository.awardForSettledBill(salonId, billId);
    }

    reversePointsForRefund(salonId: string, billId: string, refundId: string) {
        return this.repository.reversePointsForRefund(salonId, billId, refundId);
    }
}
