import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { EmployeeManagementController } from './employee_management.controller.js';
import { EmployeeManagementRepository } from './employee_management.repository.js';
import { EmployeeManagementService } from './employee_management.service.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const employeeManagementRoutes: FastifyPluginAsync = async (app) => {
    const controller = new EmployeeManagementController(
        new EmployeeManagementService(new EmployeeManagementRepository())
    );
    const authenticate = (
        request: Parameters<typeof authMiddleware.verifyToken>[0],
        reply: Parameters<typeof authMiddleware.verifyToken>[1]
    ) => authMiddleware.verifyToken(request, reply);
    const authenticated = { preHandler: [authenticate] };
    const staffManager = {
        preHandler: [authenticate, rbacMiddleware.check('staff:manage')],
    };
    const billingManager = {
        preHandler: [authenticate, rbacMiddleware.check('billing:manage')],
    };

    app.post('/salons/:salonId/employee-attendance/clock-ins', authenticated, (request, reply) =>
        controller.clockIn(request, reply)
    );
    app.post('/salons/:salonId/employee-attendance/clock-outs', authenticated, (request) =>
        controller.clockOut(request)
    );
    app.post('/salons/:salonId/employee-attendance/lunch-breaks', authenticated, (request, reply) =>
        controller.startLunch(request, reply)
    );
    app.post('/salons/:salonId/employee-attendance/lunch-breaks/closures', authenticated, (request) =>
        controller.endLunch(request)
    );
    app.get('/me/salons/:salonId/employee-ledger', authenticated, (request) =>
        controller.getEmployeeLedger(request)
    );
    app.get('/me/salons/:salonId/employee-leave-balances', authenticated, (request) =>
        controller.listLeaveBalances(request)
    );
    app.get('/me/salons/:salonId/employee-leave-requests', authenticated, (request) =>
        controller.listMyLeaveRequests(request)
    );
    app.post('/salons/:salonId/employee-leave-requests', authenticated, (request, reply) =>
        controller.createLeaveRequest(request, reply)
    );
    app.post(
        '/me/salons/:salonId/employee-leave-requests/:requestId/cancellations',
        authenticated,
        (request) => controller.cancelLeaveRequest(request)
    );
    app.get('/salons/:salonId/employee-leave-types', authenticated, (request) =>
        controller.listLeaveTypes(request)
    );
    app.get('/salons/:salonId/employee-holidays', authenticated, (request) =>
        controller.listHolidays(request)
    );
    app.get('/me/salons/:salonId/staff-tip-ledger', authenticated, (request) =>
        controller.getMyTipLedger(request)
    );
    app.post('/me/salons/:salonId/pos-tip-requests', authenticated, (request, reply) =>
        controller.createCustomerTipRequest(request, reply)
    );
    app.post('/me/salons/:salonId/pos-tip-refund-requests', authenticated, (request, reply) =>
        controller.createCustomerTipRefundRequest(request, reply)
    );
    app.get('/me/salons/:salonId/pos-tip-refund-requests', authenticated, (request) =>
        controller.listMyTipRefundRequests(request)
    );

    app.post('/salons/:salonId/employee-holidays', staffManager, (request, reply) =>
        controller.createHoliday(request, reply)
    );
    app.delete('/salons/:salonId/employee-holidays/:holidayId', staffManager, (request, reply) =>
        controller.deleteHoliday(request, reply)
    );
    app.post('/salons/:salonId/employee-leave-types', staffManager, (request, reply) =>
        controller.createLeaveType(request, reply)
    );
    app.get('/salons/:salonId/employee-leave-requests', staffManager, (request) =>
        controller.listLeaveRequests(request)
    );
    app.get('/salons/:salonId/employee-members/:membershipId/ledger', staffManager, (request) =>
        controller.getMemberLedger(request)
    );
    app.get('/salons/:salonId/employee-members/:membershipId/leave-balances', staffManager, (request) =>
        controller.listMemberLeaveBalances(request)
    );
    app.get('/salons/:salonId/employee-members/:membershipId/tip-ledger', staffManager, (request) =>
        controller.getMemberTipLedger(request)
    );
    app.patch('/salons/:salonId/employee-leave-requests/:requestId', staffManager, (request) =>
        controller.reviewLeaveRequest(request)
    );
    app.post(
        '/salons/:salonId/employee-members/:membershipId/leave-ledger-entries',
        staffManager,
        (request, reply) => controller.createLeaveLedgerEntry(request, reply)
    );
    app.post('/salons/:salonId/employee-service-work', staffManager, (request, reply) =>
        controller.startServiceWork(request, reply)
    );
    app.post('/salons/:salonId/employee-service-work/:workId/completions', staffManager, (request) =>
        controller.endServiceWork(request)
    );
    app.post('/salons/:salonId/pos-tip-requests', billingManager, (request, reply) =>
        controller.createDeskTipRequest(request, reply)
    );
    app.get('/salons/:salonId/pos-tip-requests', staffManager, (request) =>
        controller.listTipRequests(request)
    );
    app.patch('/salons/:salonId/pos-tip-requests/:tipRequestId', staffManager, (request) =>
        controller.reviewTipRequest(request)
    );
    app.post('/salons/:salonId/pos-tip-refund-requests', billingManager, (request, reply) =>
        controller.createDeskTipRefundRequest(request, reply)
    );
    app.get('/salons/:salonId/pos-tip-refund-requests', staffManager, (request) =>
        controller.listTipRefundRequests(request)
    );
    app.patch('/salons/:salonId/pos-tip-refund-requests/:refundRequestId', staffManager, (request) =>
        controller.reviewTipRefundRequest(request)
    );
    app.post(
        '/salons/:salonId/pos-tip-refund-requests/:refundRequestId/completions',
        staffManager,
        (request) => controller.completeTipRefundRequest(request)
    );
};
