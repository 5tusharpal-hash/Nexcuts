import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { EmployeeManagementService } from './employee_management.service.js';
import {
    createHolidaySchema,
    createLeaveLedgerEntrySchema,
    createLeaveRequestSchema,
    createLeaveTypeSchema,
    createServiceWorkSchema,
    createTipRequestSchema,
    createTipRefundRequestSchema,
    dateRangeQuerySchema,
    holidayParamSchema,
    leaveListQuerySchema,
    membershipParamSchema,
    requestParamSchema,
    reviewLeaveRequestSchema,
    reviewTipRequestSchema,
    reviewTipRefundRequestSchema,
    completeTipRefundRequestSchema,
    tipRefundRequestParamSchema,
    tipListQuerySchema,
    tipRefundListQuerySchema,
    tipRequestParamSchema,
    workParamSchema,
} from './employee_management.validation.js';

export class EmployeeManagementController {
    constructor(private readonly service: EmployeeManagementService) {}

    async clockIn(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.clockIn(this.salonId(request), this.accountId(request));
        return reply.status(201).send({ success: true, data: result });
    }

    async clockOut(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.clockOut(this.salonId(request), this.accountId(request)),
        };
    }

    async startLunch(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.startLunch(this.salonId(request), this.accountId(request));
        return reply.status(201).send({ success: true, data: result });
    }

    async endLunch(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.endLunch(this.salonId(request), this.accountId(request)),
        };
    }

    async listHolidays(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.listHolidays(
                this.salonId(request),
                dateRangeQuerySchema.parse(request.query)
            ),
        };
    }

    async createHoliday(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createHoliday(
            this.salonId(request),
            this.accountId(request),
            createHolidaySchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async deleteHoliday(request: FastifyRequest, reply: FastifyReply) {
        await this.service.deleteHoliday(
            this.salonId(request),
            holidayParamSchema.parse(request.params).holidayId
        );
        return reply.status(204).send();
    }

    async listLeaveTypes(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.listLeaveTypes(this.salonId(request)),
        };
    }

    async createLeaveType(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createLeaveType(
            this.salonId(request),
            createLeaveTypeSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async createLeaveRequest(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createLeaveRequest(
            this.salonId(request),
            this.accountId(request),
            createLeaveRequestSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async listMyLeaveRequests(request: FastifyRequest) {
        const query = leaveListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listLeaveRequests(
                this.salonId(request), query, this.accountId(request), query.status
            ),
        };
    }

    async listLeaveRequests(request: FastifyRequest) {
        const query = leaveListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listLeaveRequests(
                this.salonId(request), query, undefined, query.status
            ),
        };
    }

    async reviewLeaveRequest(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.reviewLeaveRequest(
                this.salonId(request),
                requestParamSchema.parse(request.params).requestId,
                this.accountId(request),
                reviewLeaveRequestSchema.parse(request.body)
            ),
        };
    }

    async cancelLeaveRequest(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.cancelLeaveRequest(
                this.salonId(request),
                requestParamSchema.parse(request.params).requestId,
                this.accountId(request)
            ),
        };
    }

    async createLeaveLedgerEntry(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createLeaveLedgerEntry(
            this.salonId(request),
            membershipParamSchema.parse(request.params).membershipId,
            this.accountId(request),
            createLeaveLedgerEntrySchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async listLeaveBalances(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.listLeaveBalances(this.salonId(request), this.accountId(request)),
        };
    }

    async getEmployeeLedger(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getEmployeeLedger(
                this.salonId(request),
                this.accountId(request),
                dateRangeQuerySchema.parse(request.query)
            ),
        };
    }

    async getMemberLedger(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getMemberLedger(
                this.salonId(request),
                membershipParamSchema.parse(request.params).membershipId,
                dateRangeQuerySchema.parse(request.query)
            ),
        };
    }

    async listMemberLeaveBalances(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.listMemberLeaveBalances(
                this.salonId(request),
                membershipParamSchema.parse(request.params).membershipId
            ),
        };
    }

    async startServiceWork(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.startServiceWork(
            this.salonId(request),
            this.accountId(request),
            createServiceWorkSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async endServiceWork(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.endServiceWork(
                this.salonId(request),
                workParamSchema.parse(request.params).workId,
                this.accountId(request)
            ),
        };
    }

    async createCustomerTipRequest(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createTipRequest(
            this.salonId(request),
            this.accountId(request),
            createTipRequestSchema.parse(request.body),
            'CUSTOMER'
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async createDeskTipRequest(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createTipRequest(
            this.salonId(request),
            this.accountId(request),
            createTipRequestSchema.parse(request.body),
            'DESK'
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async createCustomerTipRefundRequest(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createTipRefundRequest(
            this.salonId(request),
            this.accountId(request),
            createTipRefundRequestSchema.parse(request.body),
            'CUSTOMER'
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async createDeskTipRefundRequest(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createTipRefundRequest(
            this.salonId(request),
            this.accountId(request),
            createTipRefundRequestSchema.parse(request.body),
            'DESK'
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async listMyTipRefundRequests(request: FastifyRequest) {
        const query = tipRefundListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listTipRefundRequests(
                this.salonId(request), query, query.status, this.accountId(request)
            ),
        };
    }

    async listTipRefundRequests(request: FastifyRequest) {
        const query = tipRefundListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listTipRefundRequests(
                this.salonId(request), query, query.status
            ),
        };
    }

    async reviewTipRefundRequest(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.reviewTipRefundRequest(
                this.salonId(request),
                tipRefundRequestParamSchema.parse(request.params).refundRequestId,
                this.accountId(request),
                reviewTipRefundRequestSchema.parse(request.body)
            ),
        };
    }

    async completeTipRefundRequest(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.completeTipRefundRequest(
                this.salonId(request),
                tipRefundRequestParamSchema.parse(request.params).refundRequestId,
                this.accountId(request),
                completeTipRefundRequestSchema.parse(request.body)
            ),
        };
    }

    async listTipRequests(request: FastifyRequest) {
        const query = tipListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listTipRequests(this.salonId(request), query, query.status),
        };
    }

    async reviewTipRequest(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.reviewTipRequest(
                this.salonId(request),
                tipRequestParamSchema.parse(request.params).tipRequestId,
                this.accountId(request),
                reviewTipRequestSchema.parse(request.body)
            ),
        };
    }

    async getMyTipLedger(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getMyTipLedger(
                this.salonId(request),
                this.accountId(request),
                dateRangeQuerySchema.parse(request.query)
            ),
        };
    }

    async getMemberTipLedger(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getMemberTipLedger(
                this.salonId(request),
                membershipParamSchema.parse(request.params).membershipId,
                dateRangeQuerySchema.parse(request.query)
            ),
        };
    }

    private salonId(request: FastifyRequest): string {
        return requireRouteParam(request.params, 'salonId');
    }

    private accountId(request: FastifyRequest): string {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        return request.user.id;
    }
}
