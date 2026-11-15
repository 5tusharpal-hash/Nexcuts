export interface StaffPhoneVerificationRequest {
  phone_number: string;
}

export interface CreateStaffAccountRequest {
  phone_number: string;
  code: string;
  full_name?: string;
  email?: string;
  password?: string;
  expertise?: string[];
  commission_rate?: number;
}

export interface StaffAccountLinkResponse {
  accountId: string;
  membershipId: string;
  salonId: string;
  accountLink: 'CREATED' | 'LINKED';
  role: 'STYLIST';
}
