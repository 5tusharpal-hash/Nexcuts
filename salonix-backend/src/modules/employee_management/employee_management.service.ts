import { EmployeeManagementRepository } from './employee_management.repository.js';
import type {
    CreateHolidayRequest,
    CreateLeaveLedgerEntryRequest,
    CreateLeaveRequest,
    CreateLeaveTypeRequest,
    CreateServiceWorkRequest,
    CreateTipRequest,
    CreateTipRefundRequest,
    CompleteTipRefundRequest,
    DateRangeQuery,
    ReviewLeaveRequest,
    ReviewTipRequest,
    ReviewTipRefundRequest,
} from './employee_management.types.js';

export class EmployeeManagementService {
    constructor(private readonly repository: EmployeeManagementRepository) {}

    clockIn(salonId: string, accountId: string) {
        return this.repository.clockIn(salonId, accountId);
    }

    clockOut(salonId: string, accountId: string) {
        return this.repository.clockOut(salonId, accountId);
    }

    startLunch(salonId: string, accountId: string) {
        return this.repository.startLunch(salonId, accountId);
    }

    endLunch(salonId: string, accountId: string) {
        return this.repository.endLunch(salonId, accountId);
    }

    listHolidays(salonId: string, query: DateRangeQuery) {
        return this.repository.listHolidays(salonId, query);
    }

    createHoliday(salonId: string, accountId: string, input: CreateHolidayRequest) {
        return this.repository.createHoliday(salonId, accountId, input);
    }

    deleteHoliday(salonId: string, holidayId: string) {
        return this.repository.deleteHoliday(salonId, holidayId);
    }

    listLeaveTypes(salonId: string) {
        return this.repository.listLeaveTypes(salonId);
    }

    createLeaveType(salonId: string, input: CreateLeaveTypeRequest) {
        return this.repository.createLeaveType(salonId, input);
    }

    createLeaveRequest(salonId: string, accountId: string, input: CreateLeaveRequest) {
        return this.repository.createLeaveRequest(salonId, accountId, input);
    }

    listLeaveRequests(
        salonId: string,
        query: DateRangeQuery,
        accountId?: string,
        status?: string
    ) {
        return this.repository.listLeaveRequests(salonId, query, accountId, status);
    }

    reviewLeaveRequest(
        salonId: string,
        requestId: string,
        accountId: string,
        input: ReviewLeaveRequest
    ) {
        return this.repository.reviewLeaveRequest(salonId, requestId, accountId, input);
    }

    cancelLeaveRequest(salonId: string, requestId: string, accountId: string) {
        return this.repository.cancelLeaveRequest(salonId, requestId, accountId);
    }

    createLeaveLedgerEntry(
        salonId: string,
        membershipId: string,
        accountId: string,
        input: CreateLeaveLedgerEntryRequest
    ) {
        return this.repository.createLeaveLedgerEntry(salonId, membershipId, accountId, input);
    }

    listLeaveBalances(salonId: string, accountId: string) {
        return this.repository.listLeaveBalances(salonId, accountId);
    }

    getEmployeeLedger(salonId: string, accountId: string, query: DateRangeQuery) {
        return this.repository.getEmployeeLedger(salonId, accountId, query);
    }

    getMemberLedger(salonId: string, membershipId: string, query: DateRangeQuery) {
        return this.repository.getMemberLedger(salonId, membershipId, query);
    }

    listMemberLeaveBalances(salonId: string, membershipId: string) {
        return this.repository.listLeaveBalancesForMembership(salonId, membershipId);
    }

    startServiceWork(salonId: string, accountId: string, input: CreateServiceWorkRequest) {
        return this.repository.startServiceWork(salonId, accountId, input);
    }

    endServiceWork(salonId: string, workId: string, accountId: string) {
        return this.repository.endServiceWork(salonId, workId, accountId);
    }

    createTipRequest(
        salonId: string,
        accountId: string,
        input: CreateTipRequest,
        source: 'CUSTOMER' | 'DESK'
    ) {
        return this.repository.createTipRequest(salonId, accountId, input, source);
    }

    listTipRequests(salonId: string, query: DateRangeQuery, status?: string) {
        return this.repository.listTipRequests(salonId, query, status);
    }

    reviewTipRequest(
        salonId: string,
        tipRequestId: string,
        accountId: string,
        input: ReviewTipRequest
    ) {
        return this.repository.reviewTipRequest(salonId, tipRequestId, accountId, input);
    }

    createTipRefundRequest(
        salonId: string,
        accountId: string,
        input: CreateTipRefundRequest,
        source: 'CUSTOMER' | 'DESK'
    ) {
        return this.repository.createTipRefundRequest(salonId, accountId, input, source);
    }

    listTipRefundRequests(
        salonId: string,
        query: DateRangeQuery,
        status?: string,
        accountId?: string
    ) {
        return this.repository.listTipRefundRequests(salonId, query, status, accountId);
    }

    reviewTipRefundRequest(
        salonId: string,
        refundRequestId: string,
        accountId: string,
        input: ReviewTipRefundRequest
    ) {
        return this.repository.reviewTipRefundRequest(
            salonId, refundRequestId, accountId, input
        );
    }

    completeTipRefundRequest(
        salonId: string,
        refundRequestId: string,
        accountId: string,
        input: CompleteTipRefundRequest
    ) {
        return this.repository.completeTipRefundRequest(
            salonId, refundRequestId, accountId, input
        );
    }

    getMyTipLedger(salonId: string, accountId: string, query: DateRangeQuery) {
        return this.repository.getMyTipLedger(salonId, accountId, query);
    }

    getMemberTipLedger(salonId: string, membershipId: string, query: DateRangeQuery) {
        return this.repository.getTipLedgerForMembership(salonId, membershipId, query);
    }
}
