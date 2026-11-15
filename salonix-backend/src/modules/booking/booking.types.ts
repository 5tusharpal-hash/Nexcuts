export interface BookingRequest {
    userId: string;
    salonId: string;
    serviceId: string;
    staffId?: string;
    appointmentTime: Date;
    type: 'APPOINTMENT' | 'WALK_IN' | 'GROUP';
    note?: string;
    replaceQueueEntryId?: string;
    replaceBookingId?: string;
}

export interface BookingStatus {
    id: string;
    userId: string;
    salonId: string;
    serviceId: string;
    staffId?: string;
    appointmentTime: Date;
    status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
    bookingType: 'APPOINTMENT' | 'WALK_IN' | 'GROUP';
    createdAt: Date;
}

export interface BookingConfirmation {
    bookingId: string;
    staffId: string;
    appointmentTime: Date;
    status: 'CONFIRMED';
}
