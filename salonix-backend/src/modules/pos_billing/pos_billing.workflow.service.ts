import { SalonOfferingsRepository } from '../salon_offerings/salon_offerings.repository.js';
import { AuthOtpService } from '../auth/auth-otp.service.js';
import { logger } from '../../bootstrap/logger.js';
import { LoyaltyRepository } from '../loyalty/loyalty.repository.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { PosBillingWorkflowRepository } from './pos_billing.workflow.repository.js';
import type {
    AllocateAdvanceRequest,
    CreateAdvanceClaimRequest,
    CreatePaymentClaimRequest,
    PosBillCategoryOverrideRequest,
    PosCategorySettingRequest,
    PosTaxCategory,
    CreatePosWalletRedemptionRequest,
    ReviewPosWalletRedemptionRequest,
    CreatePosSessionRequest,
    PosBillLineRequest,
    RecordPosPaymentRequest,
    ReviewPaymentClaimRequest,
    CreatePosRefundRequest,
    ReviewPosRefundRequest,
} from './pos_billing.types.js';

export class PosBillingWorkflowService {
    private readonly offers = new SalonOfferingsRepository();
    private readonly authOtp = new AuthOtpService();
    private readonly loyalty = new LoyaltyService(new LoyaltyRepository());

    constructor(private readonly repository: PosBillingWorkflowRepository) {}

    createSession(salonId: string, actorId: string, input: CreatePosSessionRequest) {
        return this.repository.createSession(salonId, actorId, input);
    }

    createBill(salonId: string, sessionId: string, actorId: string, items: PosBillLineRequest[]) {
        return this.repository.createBill(salonId, sessionId, actorId, items);
    }

    updateBill(salonId: string, billId: string, actorId: string, items: PosBillLineRequest[]) {
        return this.repository.updateBill(salonId, billId, actorId, items);
    }

    issueBill(salonId: string, billId: string, actorId: string, customerMessage?: string) {
        return this.repository.issueBillVersion(salonId, billId, actorId, customerMessage);
    }

    confirmBill(salonId: string, billId: string, versionId: string, actorId: string) {
        return this.repository.confirmBill(salonId, billId, versionId, actorId);
    }

    async recordPayment(
        salonId: string,
        billId: string,
        actorId: string,
        input: RecordPosPaymentRequest
    ) {
        const bill = await this.repository.recordPayment(salonId, billId, actorId, input);
        return this.settlePaidOffer(salonId, billId, actorId, bill);
    }

    createPaymentClaim(
        salonId: string,
        customerId: string,
        actorId: string,
        input: CreatePaymentClaimRequest
    ) {
        return this.repository.createPaymentClaim(salonId, customerId, actorId, input);
    }

    createAdvanceClaim(
        salonId: string,
        customerId: string,
        actorId: string,
        input: CreateAdvanceClaimRequest
    ) {
        return this.repository.createAdvanceClaim(salonId, customerId, actorId, input);
    }

    async allocateAdvance(
        salonId: string,
        billId: string,
        actorId: string,
        input: AllocateAdvanceRequest
    ) {
        const bill = await this.repository.allocateAdvance(salonId, billId, actorId, input);
        return this.settlePaidOffer(salonId, billId, actorId, bill);
    }

    async reviewPaymentClaim(
        salonId: string,
        claimId: string,
        actorId: string,
        input: ReviewPaymentClaimRequest
    ) {
        const result = await this.repository.reviewPaymentClaim(salonId, claimId, actorId, input);
        if (input.status !== 'APPROVED' || !('billId' in result) || !result.billId) return result;
        const bill = await this.repository.getBillById(salonId, result.billId);
        if (!bill || bill.balanceDue > 0) return result;
        return this.settlePaidOffer(salonId, result.billId, actorId, bill);
    }

    listPaymentClaims(salonId: string, limit: number, offset: number) {
        return this.repository.listPaymentClaims(salonId, limit, offset);
    }

    getBill(salonId: string, billId: string) {
        return this.repository.getBillById(salonId, billId);
    }

    listBills(salonId: string, limit: number, offset: number) {
        return this.repository.listBills(salonId, limit, offset);
    }

    getCustomerBill(salonId: string, customerId: string, billId: string) {
        return this.repository.getCustomerBillById(salonId, customerId, billId);
    }

    listCustomerBills(salonId: string, customerId: string, limit: number, offset: number) {
        return this.repository.listCustomerBills(salonId, customerId, limit, offset);
    }

    createRefund(
        salonId: string,
        billId: string,
        actorId: string,
        input: CreatePosRefundRequest
    ) {
        return this.repository.createRefund(salonId, billId, actorId, input);
    }

    listRefunds(salonId: string, limit: number, offset: number) {
        return this.repository.listRefunds(salonId, limit, offset);
    }

    reviewRefund(
        salonId: string,
        refundId: string,
        actorId: string,
        input: ReviewPosRefundRequest
    ) {
        return this.reviewRefundAndLoyalty(salonId, refundId, actorId, input);
    }

    private async reviewRefundAndLoyalty(
        salonId: string,
        refundId: string,
        actorId: string,
        input: ReviewPosRefundRequest
    ) {
        const result = await this.repository.reviewRefund(salonId, refundId, actorId, input);
        if (input.status === 'COMPLETED' && 'billId' in result) {
            await this.loyalty.reversePointsForRefund(salonId, result.billId, refundId);
        }
        return result;
    }

    getCategorySettings(salonId: string) {
        return this.repository.getCategorySettings(salonId);
    }

    updateCategorySetting(
        salonId: string,
        category: PosTaxCategory,
        actorId: string,
        input: PosCategorySettingRequest
    ) {
        return this.repository.updateCategorySetting(salonId, category, actorId, input);
    }

    updateBillCategoryOverride(
        salonId: string,
        billId: string,
        category: PosTaxCategory,
        actorId: string,
        input: PosBillCategoryOverrideRequest
    ) {
        return this.repository.updateBillCategoryOverride(
            salonId, billId, category, actorId, input
        );
    }

    async createWalletRedemption(
        salonId: string,
        customerId: string,
        channel: 'phone' | 'email',
        recipient: string,
        ipAddress: string,
        input: CreatePosWalletRedemptionRequest
    ) {
        await this.authOtp.enforceIdentifierRequestLimit(
            'pos-wallet-redemption', channel, recipient, ipAddress
        );
        const redemption = await this.repository.createWalletRedemption(
            salonId, customerId, input
        );
        let developmentOtp: string | undefined;
        try {
            developmentOtp = await this.authOtp.requestOtp(
                'pos-wallet-redemption',
                channel,
                recipient,
                customerId,
                redemption.id
            );
        } catch (deliveryError) {
            try {
                await this.repository.failWalletOtpDelivery(salonId, customerId, redemption.id);
            } catch (cleanupError) {
                logger.error(
                    { cleanupError, salonId, customerId, redemptionId: redemption.id },
                    'Failed to release wallet redemption after OTP delivery failure'
                );
            }
            throw deliveryError;
        }
        return { ...redemption, verificationRequired: true, developmentOtp };
    }

    async verifyWalletRedemption(
        salonId: string,
        customerId: string,
        channel: 'phone' | 'email',
        recipient: string,
        code: string,
        ipAddress: string,
        redemptionId: string
    ) {
        await this.authOtp.verifyOtp(
            'pos-wallet-redemption',
            channel,
            recipient,
            customerId,
            code,
            ipAddress,
            redemptionId
        );
        return this.repository.verifyWalletRedemption(salonId, customerId, redemptionId);
    }

    async reviewWalletRedemption(
        salonId: string,
        redemptionId: string,
        actorId: string,
        input: ReviewPosWalletRedemptionRequest
    ) {
        const result = await this.repository.reviewWalletRedemption(
            salonId, redemptionId, actorId, input
        );
        if (input.status !== 'APPROVED') return result;
        const bill = await this.repository.getBillById(salonId, result.billId);
        if (!bill || bill.balanceDue > 0) return result;
        return this.settlePaidOffer(salonId, result.billId, actorId, bill);
    }

    private async settlePaidOffer(
        salonId: string,
        billId: string,
        actorId: string,
        bill: Awaited<ReturnType<PosBillingWorkflowRepository['getBillById']>>
    ) {
        if (!bill || bill.balanceDue > 0) return bill;
        let offerPurchase: Awaited<ReturnType<SalonOfferingsRepository['confirmSettlement']>> | undefined;
        if (bill.offerPurchaseRequestId) {
            offerPurchase = await this.offers.confirmSettlement(
                salonId,
                bill.offerPurchaseRequestId,
                actorId,
                billId,
                `pos-offer-sale:${billId}`
            );
        }
        await this.loyalty.awardForSettledBill(salonId, billId);
        return offerPurchase ? { ...bill, offerPurchase } : bill;
    }
}
