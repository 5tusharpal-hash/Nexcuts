export interface StaffMember {
    id: string;
    userId: string;
    salonId: string;
    roles: string[];
    expertise: string[]; // Array of serviceIds they can perform
    status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'ENDED';
    commissionRate: number;
    joinedDate: Date;
}

export interface StaffOnboardingRequest {
    email: string;
    password: string;
    phone: string;
    fullName: string;
    salonId: string;
    expertise?: string[];
    commissionRate?: number;
    roles?: string[];
    role?: string;
}

export interface StaffAccountData {
    email: string;
    passwordHash: string;
    phoneNumber: string;
    fullName: string;
}

export interface StaffOnboardingData {
    salonId: string;
    expertise: string[];
    commissionRate: number;
    roles: string[];
}

export interface StaffAvailability {
    staffId: string;
    dayOfWeek: number; // 0-6
    startTime: string; // "HH:mm"
    endTime: string; // "HH:mm"
}

export interface AssignStaffRequest {
    bookingId: string;
    staffId: string;
    serviceId: string;
}

export interface StaffPerformanceSummary {
    staffId: string;
    totalServices: number;
    totalRevenue: number;
    averageRating: number;
}
