export type AdminAccountType = 'CUSTOMER' | 'SALON' | 'PLATFORM' | 'ADMIN';
export type AdminAccountStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface AdminPagination {
  limit: number;
  offset: number;
}

export interface AdminSalonListQuery extends AdminPagination {
  search?: string;
  applicationStatus?: string;
  salonStatus?: string;
  city?: string;
}

export interface AdminAccountListQuery extends AdminPagination {
  search?: string;
  accountType?: AdminAccountType;
  status?: AdminAccountStatus;
}

export interface AdminSalonSummary {
  salonId: string;
  organizationId: string;
  organizationName: string;
  branchCode: string;
  salonName: string;
  city: string | null;
  salonStatus: string;
  applicationStatus: string;
  submittedAt: Date;
  ownerName: string;
  ownerEmail: string | null;
  ownerPhoneNumber: string;
  branchCount: number;
  planName: string | null;
  planPrice: string | null;
  subscriptionStatus: string | null;
  unpaidInvoiceCount: number;
  totalCount: number;
}

export interface AdminAccountSummary {
  id: string;
  accountType: AdminAccountType;
  fullName: string;
  email: string | null;
  phoneNumber: string;
  status: AdminAccountStatus;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  createdAt: Date;
  activeSessionCount: number;
  organizationNames: string[];
  totalCount: number;
}

export interface AdminPlanUpdate {
  name: string;
  description: string | null;
  monthlyPrice: number;
  isActive: boolean;
  features: Record<string, unknown>;
  reason: string;
}

export interface AdminAddonUpdate {
  name: string;
  description: string | null;
  price: number;
  isRecurring: boolean;
  isActive: boolean;
  reason: string;
}

export interface AdminSubscriptionUpdate {
  planId: string;
  billingCycleStart: string;
  billingCycleEnd: string;
  reason: string;
}

export interface AdminEntitlementUpdate {
  featureKey: string;
  featureValue: unknown;
  reason: string;
  expiresAt: string | null;
}

export interface AdminStatusUpdate {
  status: 'ACTIVE' | 'SUSPENDED';
  reason: string;
}

export interface SalonProfileChangeRequestInput {
  organizationName?: string;
  legalName?: string | null;
  salonName?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string;
  ownerNote?: string;
}

export interface SalonProfileChangeReviewInput {
  status: 'APPROVED' | 'REJECTED';
  reviewNotes?: string;
}

export interface AdminActionContext {
  actorAccountId: string;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}
