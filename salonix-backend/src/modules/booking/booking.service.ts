import { BookingRepository } from './booking.repository';
import { BookingRequest, BookingConfirmation } from './booking.types';
import { StaffService } from '../staff/staff.service';

export class BookingService {
    constructor(
        private repository: BookingRepository,
        private staffService: StaffService
    ) {}

    async createAppointment(data: BookingRequest): Promise<BookingConfirmation> {
        // 1. Find available staff for this service
        const availableStaff = await this.repository.findAvailableStaff(
            data.salonId,
            data.serviceId,
            data.appointmentTime,
            data.replaceBookingId
        );

        if (availableStaff.length === 0) {
            throw new Error('No available staff for this service at the requested time');
        }

        // 2. Auto-assign the first available staff (Simple load balancing)
        const assignedStaffId = data.staffId || availableStaff[0];

        // 3. Verify if that staff is actually available on that day/time
        const isAvailable = await this.staffService.checkStaffAvailability(
            assignedStaffId,
            data.appointmentTime,
            data.appointmentTime.toTimeString().slice(0, 5)
        );

        if (!isAvailable) {
            throw new Error('Selected professional is not available at this time');
        }

        // 4. Create the booking
        const booking = await this.repository.createBooking({
            ...data,
            staffId: assignedStaffId
        });

        return {
            bookingId: booking.id,
            staffId: assignedStaffId,
            appointmentTime: booking.appointmentTime,
            status: 'CONFIRMED'
        };
    }

    async cancelBooking(bookingId: string, customerAccountId: string) {
        return this.repository.updateBookingStatus(bookingId, 'CANCELLED', customerAccountId);
    }
}
