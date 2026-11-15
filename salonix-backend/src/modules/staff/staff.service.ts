import { StaffRepository } from './staff.repository';
import bcrypt from 'bcrypt';
import { StaffOnboardingRequest } from './staff.types';

const SALT_ROUNDS = 12;

export class StaffService {
    constructor(private repository: StaffRepository) {}

    async onboardStaff(data: StaffOnboardingRequest) {
        const roles = [...new Set(data.roles ?? [data.role ?? 'STYLIST'])];
        if (roles.length === 0) throw new Error('At least one salon role must be assigned');

        const userData = {
            email: data.email.trim().toLowerCase(),
            passwordHash: await bcrypt.hash(data.password, SALT_ROUNDS),
            phoneNumber: data.phone,
            fullName: data.fullName,
        };

        const staffData = {
            salonId: data.salonId,
            expertise: data.expertise ?? [],
            commissionRate: data.commissionRate ?? 0,
            roles,
        };

        return this.repository.createStaffWithUser(userData, staffData);
    }

    async getAvailableStylists(salonId: string, serviceId: string) {
        return this.repository.findStaffByExpertise(salonId, serviceId);
    }

    async checkStaffAvailability(staffId: string, date: Date, time: string) {
        const availability = await this.repository.getAvailability(staffId);
        const dayOfWeek = date.getDay();

        const schedule = availability.find(a => a.dayOfWeek === dayOfWeek);
        if (!schedule) return false;

        return time >= schedule.startTime && time <= schedule.endTime;
    }

    async updateProfessionalRate(staffId: string, rate: number) {
        return this.repository.updateCommission(staffId, rate);
    }
}
