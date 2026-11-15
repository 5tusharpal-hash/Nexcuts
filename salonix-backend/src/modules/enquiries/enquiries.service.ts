import { AuthOtpService } from '../auth/auth-otp.service.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { EnquiriesRepository } from './enquiries.repository.js';
import {
    CreateEnquiryRequest,
    EnquiryListQuery,
    UpdateEnquiryStatusRequest,
} from './enquiries.types.js';

export class EnquiriesService {
    constructor(
        private readonly repository: EnquiriesRepository,
        private readonly rateLimiter = new AuthOtpService()
    ) {}

    async createEnquiry(
        data: CreateEnquiryRequest,
        ipAddress: string
    ) {
        await this.rateLimiter.enforceRateLimit('public-enquiry:ip', ipAddress, 10, 60 * 60);
        await this.rateLimiter.enforceRateLimit(
            `public-enquiry:phone:${data.branchId}`,
            data.customerPhone,
            3,
            60 * 60
        );
        return this.repository.createEnquiry(data);
    }

    async listEnquiries(branchId: string, query: EnquiryListQuery) {
        return this.repository.getEnquiriesByBranch(branchId, query);
    }

    async updateStatus(
        branchId: string,
        enquiryId: string,
        input: UpdateEnquiryStatusRequest
    ) {
        await this.repository.updateStatus(branchId, enquiryId, input.status);
    }

    async addResponse(
        branchId: string,
        enquiryId: string,
        actorAccountId: string,
        note: string,
        isExternalReply: boolean
    ) {
        await this.repository.addResponse(
            branchId,
            enquiryId,
            actorAccountId,
            note,
            isExternalReply
        );
    }

    async listResponses(branchId: string, enquiryId: string, limit: number, offset: number) {
        const responses = await this.repository.getResponses(
            branchId,
            enquiryId,
            limit,
            offset
        );
        if (!await this.repository.enquiryExists(branchId, enquiryId)) {
            throw new ApiError(404, 'Salon enquiry not found');
        }
        return responses;
    }
}
