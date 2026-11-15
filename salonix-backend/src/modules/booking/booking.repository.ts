import { prisma } from '../../bootstrap/db.connect';
import { BookingRequest, BookingStatus } from './booking.types';
import { ApiError } from '../../shared/errors/ApiError.js';
import { Prisma } from '../../generated/prisma/client.js';
import { indiaDayKey } from './customer-reservation.rules.js';

export class BookingRepository {
    async createBooking(data: BookingRequest): Promise<BookingStatus> {
        if (data.replaceQueueEntryId && data.replaceBookingId) {
            throw new ApiError(400, 'Provide only one reservation to replace');
        }
        const dateParts = new Intl.DateTimeFormat('en', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(data.appointmentTime);
        const datePart = (type: Intl.DateTimeFormatPartTypes) =>
            dateParts.find((part) => part.type === type)?.value;
        const year = datePart('year');
        const month = datePart('month');
        const day = datePart('day');
        if (!year || !month || !day) throw new Error('Could not determine appointment date');
        const appointmentDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

        const booking = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.userId}, 1))`;
            const service = await tx.salonService.findFirst({
                where: { id: data.serviceId, salonId: data.salonId, isActive: true },
                select: { estimatedDurationMinutes: true, basePrice: true },
            });

            if (!service) throw new Error('Active salon service not found');

            const requestedStart = data.appointmentTime;
            const requestedEnd = new Date(requestedStart.getTime() + service.estimatedDurationMinutes * 60_000);
            const requestedDay = indiaDayKey(requestedStart);
            const replacementIds = new Set([data.replaceQueueEntryId, data.replaceBookingId].filter(Boolean) as string[]);
            const [activeBookings, activeEntries] = await Promise.all([
                tx.customerBooking.findMany({
                    where: { customerAccountId: data.userId, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] } },
                    select: { id: true, appointmentAt: true, estimatedDurationMinutes: true },
                }),
                tx.queueEntry.findMany({
                    where: { customerAccountId: data.userId, status: { in: ['WAITING', 'IN_PROGRESS'] } },
                    select: { id: true, preferredTime: true, arrivalTime: true, actualStartTime: true, scheduledStartAt: true, estimatedDurationMinutes: true },
                }),
            ]);
            const overlaps = (start: Date, durationMinutes: number) =>
                requestedStart.getTime() < start.getTime() + durationMinutes * 60_000 &&
                requestedEnd.getTime() > start.getTime();
            const conflicts = activeBookings
                .filter((booking) => !replacementIds.has(booking.id))
                .filter((booking) => overlaps(booking.appointmentAt, booking.estimatedDurationMinutes));
            const queueConflicts = activeEntries
                .filter((entry) => !replacementIds.has(entry.id))
                .filter((entry) => {
                    const start = entry.actualStartTime ?? entry.scheduledStartAt ?? entry.preferredTime ?? entry.arrivalTime;
                    return start ? overlaps(start, entry.estimatedDurationMinutes) : false;
                });
            if (conflicts.length > 0 || queueConflicts.length > 0) {
                throw new ApiError(409, 'Customer already has a booking or queue entry that overlaps this time');
            }

            const sameDayConflict = activeBookings
                .filter((booking) => !replacementIds.has(booking.id))
                .some((booking) => indiaDayKey(booking.appointmentAt) === requestedDay) || activeEntries
                .filter((entry) => !replacementIds.has(entry.id))
                .some((entry) => {
                    const start = entry.actualStartTime ?? entry.scheduledStartAt ?? entry.preferredTime ?? entry.arrivalTime;
                    return start ? indiaDayKey(start) === requestedDay : false;
                });
            if (sameDayConflict) {
                throw new ApiError(409, 'Customer already has an active reservation on this day; cancel or explicitly replace it first');
            }

            if (data.replaceQueueEntryId) {
                const replacement = activeEntries.find((entry) => entry.id === data.replaceQueueEntryId);
                if (!replacement) throw new ApiError(409, 'Replacement queue entry is not active or does not belong to this customer');
                await tx.queueEntry.update({
                    where: { id: replacement.id },
                    data: { status: 'CANCELLED', scheduleVersion: { increment: 1 }, lastRecalculatedAt: new Date() },
                });
            }
            if (data.replaceBookingId) {
                const replacement = activeBookings.find((booking) => booking.id === data.replaceBookingId);
                if (!replacement) throw new ApiError(409, 'Replacement booking is not active or does not belong to this customer');
                await tx.customerBooking.update({ where: { id: replacement.id }, data: { status: 'CANCELLED' } });
            }

            const createdBooking = await tx.customerBooking.create({
                data: {
                    customerAccountId: data.userId,
                    salonId: data.salonId,
                    appointmentDate,
                    appointmentAt: data.appointmentTime,
                    estimatedDurationMinutes: service.estimatedDurationMinutes,
                    bookingType: data.type,
                    status: 'PENDING',
                    notes: data.note,
                },
            });

            await tx.customerBookingService.create({
                data: {
                    bookingId: createdBooking.id,
                    salonId: data.salonId,
                    serviceId: data.serviceId,
                    durationMinutes: service.estimatedDurationMinutes,
                    priceAtBooking: service.basePrice,
                },
            });

            if (data.staffId) {
                const skill = await tx.salonStaffSkill.findFirst({
                    where: {
                        membershipId: data.staffId,
                        salonId: data.salonId,
                        serviceId: data.serviceId,
                    },
                });
                if (!skill) throw new Error('Assigned staff member is not qualified for this service');

                await tx.customerBookingStaff.create({
                    data: {
                        bookingId: createdBooking.id,
                        salonId: data.salonId,
                        serviceId: data.serviceId,
                        membershipId: data.staffId,
                    },
                });
            }

            return createdBooking;
        });

        return {
            id: booking.id,
            userId: booking.customerAccountId,
            salonId: booking.salonId,
            serviceId: data.serviceId,
            staffId: data.staffId,
            appointmentTime: booking.appointmentAt,
            status: 'PENDING',
            bookingType: data.type,
            createdAt: booking.createdAt,
        };
    }

    async findAvailableStaff(salonId: string, serviceId: string, time: Date, replacementBookingId?: string): Promise<string[]> {
        const replacementBookingFilter = replacementBookingId
            ? Prisma.sql`AND booking.id <> ${replacementBookingId}::uuid`
            : Prisma.empty;
        const staff = await prisma.$queryRaw<Array<{ membershipId: string }>>`
            SELECT skill.membership_id AS "membershipId"
            FROM salon_staff_skills AS skill
            JOIN salon_memberships AS membership
              ON membership.id = skill.membership_id
            JOIN salon_membership_locations AS location
              ON location.membership_id = membership.id
             AND location.salon_id = skill.salon_id
            JOIN salon_services AS requested_service
              ON requested_service.id = skill.service_id
             AND requested_service.salon_id = skill.salon_id
            JOIN salons AS salon ON salon.id = skill.salon_id
            WHERE skill.salon_id = ${salonId}
              AND skill.service_id = ${serviceId}
              AND membership.status = 'ACTIVE'
              AND requested_service.is_active = TRUE
              AND EXISTS (
                SELECT 1
                FROM salon_staff_availability AS availability
                WHERE availability.membership_id = skill.membership_id
                  AND availability.salon_id = skill.salon_id
                  AND availability.day_of_week = EXTRACT(
                    DOW FROM (${time} AT TIME ZONE salon.timezone)
                  )
                  AND availability.starts_at <= (${time} AT TIME ZONE salon.timezone)::time
                  AND availability.ends_at >= (
                    (${time} AT TIME ZONE salon.timezone)
                    + requested_service.estimated_duration_minutes * INTERVAL '1 minute'
                  )::time
                  AND (
                    availability.effective_from IS NULL
                    OR availability.effective_from <= (${time} AT TIME ZONE salon.timezone)::date
                  )
                  AND (
                    availability.effective_until IS NULL
                    OR availability.effective_until >= (${time} AT TIME ZONE salon.timezone)::date
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM customer_booking_staff AS assigned
                JOIN customer_bookings AS booking ON booking.id = assigned.booking_id
                WHERE assigned.membership_id = skill.membership_id
                  AND assigned.salon_id = skill.salon_id
                  AND booking.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS')
                  AND booking.appointment_at < ${time} + (
                    SELECT requested_service.estimated_duration_minutes * INTERVAL '1 minute'
                    FROM salon_services AS requested_service
                    WHERE requested_service.id = ${serviceId}
                      AND requested_service.salon_id = ${salonId}
                  )
                  AND booking.appointment_at
                    + (booking.estimated_duration_minutes * INTERVAL '1 minute') > ${time}
              ${replacementBookingFilter}
              )
        `;
        return staff.map(({ membershipId }) => membershipId);
    }

    async updateBookingStatus(
        bookingId: string,
        status: BookingStatus['status'],
        customerAccountId: string,
    ): Promise<void> {
        const booking = await prisma.customerBooking.findUnique({
            where: { id: bookingId },
            select: { customerAccountId: true },
        });
        if (!booking || booking.customerAccountId !== customerAccountId) {
            throw new ApiError(404, 'Booking not found');
        }
        await prisma.customerBooking.update({ where: { id: bookingId }, data: { status } });
    }

    async assignStaff(bookingId: string, staffId: string): Promise<void> {
        await prisma.$transaction(async (tx) => {
            const booking = await tx.customerBooking.findUnique({
                where: { id: bookingId },
                select: { salonId: true },
            });
            if (!booking) throw new Error('Booking not found');

            const services = await tx.customerBookingService.findMany({
                where: { bookingId },
                select: { serviceId: true },
            });
            if (services.length === 0) throw new Error('Booking has no services');

            const skills = await tx.salonStaffSkill.findMany({
                where: {
                    membershipId: staffId,
                    salonId: booking.salonId,
                    serviceId: { in: services.map(({ serviceId }) => serviceId) },
                },
                select: { serviceId: true },
            });
            if (skills.length !== services.length) {
                throw new Error('Assigned staff member is not qualified for every booking service');
            }

            await tx.customerBookingStaff.createMany({
                data: services.map(({ serviceId }) => ({
                    bookingId,
                    salonId: booking.salonId,
                    serviceId,
                    membershipId: staffId,
                })),
                skipDuplicates: true,
            });
        });
    }
}
