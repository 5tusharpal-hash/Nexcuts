import { SalonOfferingsRepository } from './salon_offerings.repository.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
    AttachOfferBillRequest,
    CreateComboRequest,
    CreateManualOfferSaleRequest,
    CreatePackageRequest,
    CreatePurchaseRequest,
    OfferType,
    UpdateComboRequest,
    UpdateOfferSaleQuoteRequest,
    UpdatePackageRequest,
} from './salon_offerings.types.js';

export class SalonOfferingsService {
    constructor(private repository: SalonOfferingsRepository) {}

    createPackage(salonId: string, accountId: string, data: CreatePackageRequest) {
        if (new Set(data.services.map(({ serviceId }) => serviceId)).size !== data.services.length) {
            throw new ApiError(400, 'A package cannot include the same service more than once');
        }
        return this.repository.createPackage(salonId, accountId, data);
    }

    updatePackage(salonId: string, packageId: string, accountId: string, data: UpdatePackageRequest) {
        return this.repository.updatePackage(salonId, packageId, accountId, data);
    }

    createCombo(salonId: string, accountId: string, data: CreateComboRequest) {
        if (new Set(data.serviceIds).size !== data.serviceIds.length) {
            throw new ApiError(400, 'A combo cannot include the same service more than once');
        }
        return this.repository.createCombo(salonId, accountId, data);
    }

    updateCombo(salonId: string, comboId: string, accountId: string, data: UpdateComboRequest) {
        return this.repository.updateCombo(salonId, comboId, accountId, data);
    }

    listOfferings(
        salonId: string,
        query: { limit: number; offset: number; type?: OfferType },
        publicOnly: boolean
    ) {
        return this.repository.listOfferings(salonId, query, publicOnly);
    }

    getOffering(salonId: string, offeringId: string, type: OfferType, publicOnly: boolean) {
        return this.repository.getOffering(salonId, offeringId, type, publicOnly);
    }

    createPurchaseRequest(customerAccountId: string, salonId: string, data: CreatePurchaseRequest) {
        return this.repository.createPurchaseRequest(customerAccountId, salonId, data);
    }

    createManualSale(salonId: string, accountId: string, data: CreateManualOfferSaleRequest) {
        return this.repository.createManualSale(salonId, accountId, data);
    }

    listPurchaseRequests(
        salonId: string,
        query: { limit: number; offset: number; status?: string; type?: OfferType }
    ) {
        return this.repository.listPurchaseRequests(salonId, query);
    }

    listMyPurchases(accountId: string, limit: number, offset: number) {
        return this.repository.listMyPurchases(accountId, limit, offset);
    }

    getPurchaseRequest(salonId: string, requestId: string, customerAccountId?: string) {
        return this.repository.getPurchaseRequest(salonId, requestId, customerAccountId);
    }

    startCheckout(salonId: string, requestId: string, accountId: string) {
        return this.repository.startCheckout(salonId, requestId, accountId);
    }

    updateSaleQuote(
        salonId: string,
        requestId: string,
        accountId: string,
        data: UpdateOfferSaleQuoteRequest
    ) {
        return this.repository.updateSaleQuote(salonId, requestId, data, accountId);
    }

    attachDraftBill(
        salonId: string,
        requestId: string,
        accountId: string,
        data: AttachOfferBillRequest
    ) {
        return this.repository.attachDraftBill(salonId, requestId, data.billId, accountId);
    }

    rejectPurchaseRequest(
        salonId: string,
        requestId: string,
        accountId: string,
        reason: string
    ) {
        return this.repository.rejectPurchaseRequest(salonId, requestId, accountId, { reason });
    }

    confirmSettlement(
        salonId: string,
        requestId: string,
        accountId: string,
        billId: string,
        idempotencyKey: string
    ) {
        return this.repository.confirmSettlement(
            salonId, requestId, accountId, billId, idempotencyKey
        );
    }

    redeemPackage(
        salonId: string,
        subscriptionId: string,
        accountId: string,
        serviceId: string,
        billId: string,
        idempotencyKey: string
    ) {
        return this.repository.redeemPackage(
            salonId, subscriptionId, accountId, serviceId, billId, idempotencyKey
        );
    }

    redeemCombo(
        salonId: string,
        comboPurchaseId: string,
        accountId: string,
        serviceIds: string[],
        billId: string,
        idempotencyKey: string
    ) {
        return this.repository.redeemCombo(
            salonId, comboPurchaseId, accountId, serviceIds, billId, idempotencyKey
        );
    }

    listLedger(salonId: string, customerAccountId: string, limit: number, offset: number) {
        return this.repository.listLedger(salonId, customerAccountId, limit, offset);
    }
}
