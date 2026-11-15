import { AuthService } from '../auth/auth.service.js';
import { AdminRepository } from './admin.repository.js';
import type {
  AdminAccountListQuery,
  AdminActionContext,
  AdminAddonUpdate,
  AdminEntitlementUpdate,
  AdminPagination,
  AdminPlanUpdate,
  AdminSalonListQuery,
  AdminStatusUpdate,
  AdminSubscriptionUpdate,
  SalonProfileChangeRequestInput,
  SalonProfileChangeReviewInput,
} from './admin.types.js';

export class AdminService {
  private readonly authService = new AuthService();

  constructor(private readonly repository: AdminRepository) {}

  getDashboard() {
    return this.repository.getDashboard();
  }

  listSalons(query: AdminSalonListQuery) {
    return this.repository.listSalons(query);
  }

  getSalonDetails(salonId: string) {
    return this.repository.getSalonDetails(salonId);
  }

  listSalonActivity(salonId: string, query: AdminPagination & { resourceType?: string }) {
    return this.repository.listSalonActivity(salonId, query);
  }

  requestSalonProfileChange(
    salonId: string,
    accountId: string,
    input: SalonProfileChangeRequestInput
  ) {
    return this.repository.requestSalonProfileChange(salonId, accountId, input);
  }

  listSalonProfileChangesForOwner(salonId: string, accountId: string, query: AdminPagination) {
    return this.repository.listSalonProfileChangesForOwner(salonId, accountId, query);
  }

  listSalonProfileChangeRequests(query: AdminPagination & { status: string }) {
    return this.repository.listSalonProfileChangeRequests(query);
  }

  reviewSalonProfileChangeRequest(
    requestId: string,
    context: AdminActionContext,
    decision: SalonProfileChangeReviewInput
  ) {
    return this.repository.reviewSalonProfileChangeRequest(requestId, context, decision);
  }

  listRecentActivity(query: AdminPagination) {
    return this.repository.listRecentActivity(query);
  }

  listAccounts(query: AdminAccountListQuery) {
    return this.repository.listAccounts(query);
  }

  updateAccountStatus(
    accountId: string,
    context: AdminActionContext,
    update: AdminStatusUpdate
  ) {
    return this.repository.updateAccountStatus(accountId, context, update);
  }

  async requestAccountPasswordReset(
    accountId: string,
    context: AdminActionContext,
    reason: string,
    ipAddress: string
  ) {
    const target = await this.repository.getAccountPasswordResetTarget(accountId);
    await this.repository.recordAccountPasswordResetRequested(accountId, context, reason);
    await this.authService.requestPasswordReset(target.identifier, target.accountType, ipAddress);
    return { requested: true };
  }

  revokeAccountSessions(accountId: string, context: AdminActionContext, reason: string) {
    return this.repository.revokeAccountSessions(accountId, context, reason);
  }

  listPlans() {
    return this.repository.listPlans();
  }

  updatePlan(planId: string, context: AdminActionContext, update: AdminPlanUpdate) {
    return this.repository.updatePlan(planId, context, update);
  }

  listAddons() {
    return this.repository.listAddons();
  }

  updateAddon(addonId: string, context: AdminActionContext, update: AdminAddonUpdate) {
    return this.repository.updateAddon(addonId, context, update);
  }

  assignPlan(salonId: string, context: AdminActionContext, update: AdminSubscriptionUpdate) {
    return this.repository.assignPlan(salonId, context, update);
  }

  setAddon(salonId: string, addonId: string, context: AdminActionContext, reason: string, active: boolean) {
    return this.repository.setAddon(salonId, addonId, context, reason, active);
  }

  setEntitlement(salonId: string, context: AdminActionContext, update: AdminEntitlementUpdate) {
    return this.repository.setEntitlement(salonId, context, update);
  }

  revokeEntitlement(salonId: string, featureKey: string, context: AdminActionContext, reason: string) {
    return this.repository.revokeEntitlement(salonId, featureKey, context, reason);
  }

  getMasterSettings() {
    return this.repository.getMasterSettings();
  }
}
