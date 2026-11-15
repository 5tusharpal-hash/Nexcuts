import { PosBillingRepository } from './pos_billing.repository';
import { BillRequest } from './pos_billing.types';
import { BillItem } from './pos_billing.types';

export class PosBillingService {
    constructor(private repository: PosBillingRepository) {}

    async checkout(request: BillRequest, items: BillItem[], userId: string, salonId: string) {
        const bill = await this.repository.createBill(request, items, userId, salonId);

        return bill;
    }

    async getBill(billId: string) {
        return this.repository.getBillWithDetails(billId);
    }
}
