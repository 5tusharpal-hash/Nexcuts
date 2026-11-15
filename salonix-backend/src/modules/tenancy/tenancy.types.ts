export type SalonBusinessType = 'SOLO' | 'TEAM';
export type SalonApplicationStatus =
  | 'PENDING'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'REJECTED';

export interface SalonBusinessHourInput {
  dayOfWeek: number;
  isClosed: boolean;
  opensAt?: string;
  closesAt?: string;
}

export interface SalonApplicationServiceInput {
  name: string;
  description?: string;
  estimatedDurationMinutes: number;
  basePrice: number;
  targetAudience: 'WOMEN' | 'MEN' | 'KIDS' | 'UNISEX';
}

export interface SalonBusinessHourSummary {
  dayOfWeek: number;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export interface CreateOrganizationRequest {
  organizationName?: string;
  legalName?: string;
  businessType: SalonBusinessType;
  businessHours?: SalonBusinessHourInput[];
  services?: SalonApplicationServiceInput[];
  firstSalon: {
    branchCode?: string;
    name: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    countryCode?: string;
    timezone?: string;
  };
}

export interface UpdateSalonApplicationRequest extends CreateOrganizationRequest {}

export interface ReviewSalonApplicationRequest {
  status: Exclude<SalonApplicationStatus, 'PENDING'>;
  reviewNotes?: string;
}

export interface SalonApplicationSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  salonId: string;
  branchCode: string;
  salonName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  countryCode: string;
  timezone: string;
  businessType: SalonBusinessType;
  status: SalonApplicationStatus;
  proposedServices: SalonApplicationServiceInput[];
  businessHours: SalonBusinessHourSummary[];
  reviewNotes: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
}

export interface OrganizationSetupResponse {
  organization: {
    id: string;
    name: string;
    status: string;
  };
  salon: {
    id: string;
    organizationId: string;
    branchCode: string;
    name: string;
    status: string;
  };
  application: {
    id: string;
    status: SalonApplicationStatus;
  };
}

export interface SalonMembershipSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  salonId: string;
  branchCode: string;
  salonName: string;
  membershipStatus: string;
  salonStatus: string;
  applicationStatus: SalonApplicationStatus;
  roles: string[];
}
