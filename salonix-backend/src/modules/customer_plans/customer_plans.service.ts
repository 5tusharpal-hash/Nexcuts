import { CustomerPlanRepository } from './customer_plans.repository';
import { PlanUsageRequest } from './customer_plans.types';

export class CustomerPlanService {
    constructor(private repository: CustomerPlanRepository) {}

    async validateAndDeductSlot(request: PlanUsageRequest): Promise<{ success: boolean, reason?: string }> {
        const plan = await this.repository.findActivePlan(
            request.userId,
            request.salonId,
            request.serviceId
        );
        if (!plan) return { success: false, reason: 'No active plan found for this salon' };

        // Here we would check if the service is included in the plan and if slots remain
        // Logic based on existing loyalty-packages-combos schema
        await this.repository.updateUsage(plan.id, request.serviceId);
        return { success: true };
    }
}
