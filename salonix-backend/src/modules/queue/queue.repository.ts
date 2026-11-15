import { prisma } from '../../bootstrap/db.connect';
import { QueueEntry, QueueJoinRequest, QueueSummary } from './queue.types';
import { canTransitionQueueStatus } from './queue-scheduling.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { indiaDayKey } from '../booking/customer-reservation.rules.js';

export class QueueRepository {
    async assertSalonAccess(accountId: string, salonId: string): Promise<boolean> {
        const salon = await prisma.salon.findUnique({
            where: { id: salonId },
            select: { organizationId: true },
        });
        if (!salon) return false;
        const membership = await prisma.salonMembership.findFirst({
            where: { organizationId: salon.organizationId, accountId, status: 'ACTIVE' },
            select: { id: true },
        });
        return Boolean(membership);
    }

    async assertQueueStaffAssignment(accountId: string, salonId: string, membershipId: string): Promise<boolean> {
        const membership = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT salon_membership.id
            FROM salon_memberships salon_membership
            JOIN salon_membership_locations location
              ON location.membership_id = salon_membership.id
            WHERE salon_membership.id = ${membershipId}
              AND salon_membership.account_id = ${accountId}
              AND salon_membership.status = 'ACTIVE'
              AND location.salon_id = ${salonId}
            LIMIT 1
        `;
        return membership.length > 0;
    }

    async assertAssignedQueueStaff(accountId: string, salonId: string, entryId: string): Promise<boolean> {
        const assignments = await prisma.$queryRaw<Array<{ entry_id: string }>>`
            SELECT assignment.entry_id
            FROM queue_entry_staff assignment
            JOIN salon_memberships membership ON membership.id = assignment.membership_id
            JOIN salon_membership_locations location ON location.membership_id = membership.id
            WHERE assignment.entry_id = ${entryId}
              AND assignment.salon_id = ${salonId}
              AND membership.account_id = ${accountId}
              AND membership.status = 'ACTIVE'
              AND location.salon_id = ${salonId}
              AND assignment.status IN ('IN_PROGRESS', 'ASSIGNED')
            LIMIT 1
        `;
        return assignments.length > 0;
    }

    async assertQueueAdmin(accountId: string, salonId: string): Promise<boolean> {
        const salon = await prisma.salon.findUnique({ where: { id: salonId }, select: { organizationId: true } });
        if (!salon) return false;
        const owner = await prisma.salonOrganizationOwner.findFirst({
            where: { organizationId: salon.organizationId, accountId },
            select: { organizationId: true },
        });
        if (owner) return true;
        const manager = await prisma.$queryRaw<Array<{ membership_id: string }>>`
            SELECT role_assignment.membership_id
            FROM salon_membership_roles role_assignment
            JOIN salon_roles role ON role.id = role_assignment.role_id
            JOIN salon_memberships membership ON membership.id = role_assignment.membership_id
            WHERE role_assignment.salon_id = ${salonId}
              AND membership.account_id = ${accountId}
              AND membership.status = 'ACTIVE'
              AND LOWER(role.key) IN ('owner', 'manager')
            LIMIT 1
        `;
        return manager.length > 0;
    }

    async addToQueue(data: QueueJoinRequest): Promise<QueueEntry> {
        if (data.replaceQueueEntryId && data.replaceBookingId) {
            throw new ApiError(400, 'Provide only one reservation to replace');
        }
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
                SELECT pg_advisory_xact_lock(hashtextextended(${data.salonId}, 0))
            `;
            await tx.$queryRaw`
                SELECT pg_advisory_xact_lock(hashtextextended(${data.userId}, 1))
            `;

            const service = await tx.salonService.findFirst({
                where: { id: data.serviceId, salonId: data.salonId, isActive: true },
                select: { estimatedDurationMinutes: true },
            });
            if (!service) throw new ApiError(404, 'Active salon service not found');

            const requestedStart = data.preferredTime ?? new Date();
            const requestedEnd = new Date(requestedStart.getTime() + service.estimatedDurationMinutes * 60_000);
            const requestedDay = indiaDayKey(requestedStart);
            const [activeBookings, activeEntries] = await Promise.all([
                tx.customerBooking.findMany({
                    where: { customerAccountId: data.userId, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] } },
                    select: { id: true, appointmentAt: true, estimatedDurationMinutes: true, status: true },
                }),
                tx.queueEntry.findMany({
                    where: { customerAccountId: data.userId, status: { in: ['WAITING', 'IN_PROGRESS'] } },
                    select: { id: true, preferredTime: true, arrivalTime: true, actualStartTime: true, scheduledStartAt: true, estimatedDurationMinutes: true, status: true },
                }),
            ]);

            const replacementIds = new Set([data.replaceQueueEntryId, data.replaceBookingId].filter(Boolean) as string[]);
            const bookingConflicts = activeBookings.filter((booking) => !replacementIds.has(booking.id));
            const entryConflicts = activeEntries.filter((entry) => !replacementIds.has(entry.id));

            const overlaps = (start: Date, end: Date) => requestedStart.getTime() < end.getTime() && requestedEnd.getTime() > start.getTime();
            const bookingOverlap = bookingConflicts.find((booking) => overlaps(
                booking.appointmentAt,
                new Date(booking.appointmentAt.getTime() + booking.estimatedDurationMinutes * 60_000),
            ));
            const entryOverlap = entryConflicts.find((entry) => {
                const start = entry.preferredTime ?? entry.actualStartTime ?? entry.scheduledStartAt ?? entry.arrivalTime ?? new Date();
                return overlaps(start, new Date(start.getTime() + entry.estimatedDurationMinutes * 60_000));
            });
            if (bookingOverlap || entryOverlap) throw new ApiError(409, 'Customer already has a booking or queue entry that overlaps this time');

            const sameDayConflict = bookingConflicts.some((booking) => indiaDayKey(booking.appointmentAt) === requestedDay)
                || entryConflicts.some((entry) => {
                    const start = entry.preferredTime ?? entry.actualStartTime ?? entry.scheduledStartAt ?? entry.arrivalTime;
                    return start ? indiaDayKey(start) === requestedDay : false;
                });
            if (sameDayConflict) {
                throw new ApiError(409, 'Customer already has an active reservation on this day; cancel or explicitly replace it first');
            }

            if (data.replaceQueueEntryId) {
                const replacement = activeEntries.find((entry) => entry.id === data.replaceQueueEntryId);
                if (!replacement) throw new ApiError(409, 'Replacement queue entry is not active or does not belong to this customer');
                await tx.queueEntry.update({ where: { id: replacement.id }, data: { status: 'CANCELLED', scheduleVersion: { increment: 1 }, lastRecalculatedAt: new Date() } });
            }
            if (data.replaceBookingId) {
                const replacement = activeBookings.find((booking) => booking.id === data.replaceBookingId);
                if (!replacement) throw new ApiError(409, 'Replacement booking is not active or does not belong to this customer');
                await tx.customerBooking.update({ where: { id: replacement.id }, data: { status: 'CANCELLED' } });
            }

            const waitingDuration = await tx.queueEntry.aggregate({
                where: { salonId: data.salonId, status: 'WAITING' },
                _sum: { estimatedDurationMinutes: true },
            });
            const lastPosition = await tx.queueEntry.aggregate({
                where: { salonId: data.salonId, status: 'WAITING' },
                _max: { position: true },
            });
            const priority = this.priorityValue(data.priority);
            const entry = await tx.queueEntry.create({
                data: {
                    customerAccountId: data.userId,
                    salonId: data.salonId,
                    entryType: 'WALK_IN',
                    estimatedDurationMinutes: service.estimatedDurationMinutes,
                    arrivalTime: new Date(),
                    priority,
                    preferredTime: data.preferredTime,
                    customerChoiceStylist: Boolean(data.preferredStaffId),
                    position: (lastPosition._max.position ?? 0) + 1,
                    status: 'WAITING',
                },
            });

            if (data.marketingConsent !== undefined) {
                await tx.$executeRaw`
                    INSERT INTO salon_marketing_consents (
                        salon_id, customer_account_id, consent_scope, is_granted,
                        source, consent_text_version, queue_entry_id
                    ) VALUES (
                        ${data.salonId}::uuid, ${data.userId}::uuid, 'ALL',
                        ${data.marketingConsent}, 'QUEUE_ENTRY', 'queue-marketing-v1',
                        ${entry.id}::uuid
                    )
                `;
            }

            await tx.queueEntryService.create({
                data: {
                    entryId: entry.id,
                    salonId: data.salonId,
                    serviceId: data.serviceId,
                    durationMinutes: service.estimatedDurationMinutes,
                },
            });

            if (data.preferredTime) {
                const requestedDay = data.preferredTime.getDay();
                const businessHours = await tx.salonBusinessHours.findUnique({ where: { salonId_dayOfWeek: { salonId: data.salonId, dayOfWeek: requestedDay } } });
                if (!businessHours?.isClosed && businessHours?.closesAt) {
                    const closesAt = new Date(data.preferredTime);
                    closesAt.setHours(businessHours.closesAt.getHours(), businessHours.closesAt.getMinutes(), 0, 0);
                    const requestedEndAt = new Date(data.preferredTime.getTime() + service.estimatedDurationMinutes * 60_000);
                    if (requestedEndAt.getTime() > closesAt.getTime()) {
                        await tx.queueClosingRequest.create({
                            data: {
                                entryId: entry.id,
                                salonId: data.salonId,
                                requestedByAccountId: data.userId,
                                requestedStartAt: data.preferredTime,
                                requestedEndAt,
                                expiresAt: new Date(Date.now() + 5 * 60_000),
                            },
                        });
                    }
                }
            }
            if (data.preferredStaffId) {
                const preferredStaffSkill = await tx.salonStaffSkill.findFirst({
                    where: { salonId: data.salonId, membershipId: data.preferredStaffId, serviceId: data.serviceId },
                    select: { membershipId: true },
                });
                if (!preferredStaffSkill) throw new Error('Preferred stylist is not qualified for this service');
                await tx.queueEntryStaff.create({
                    data: {
                        entryId: entry.id,
                        salonId: data.salonId,
                        membershipId: data.preferredStaffId,
                        serviceId: data.serviceId,
                        status: 'PREFERRED',
                    },
                });
            }

            return {
                id: entry.id,
                userId: entry.customerAccountId,
                salonId: entry.salonId,
                serviceId: data.serviceId,
                entryTime: entry.arrivalTime ?? entry.createdAt,
                estimatedWaitTime: waitingDuration._sum.estimatedDurationMinutes ?? 0,
                status: 'WAITING',
                priority: data.priority,
                position: entry.position,
                scheduleVersion: entry.scheduleVersion,
                updatedAt: entry.updatedAt,
            };
        });
    }

    async assertStaffCanServeEntry(entryId: string, staffId: string, allowManualOverride = false): Promise<boolean> {
        const entry = await prisma.queueEntry.findUnique({
            where: { id: entryId },
            select: { salonId: true, manualOverrideReason: true },
        });
        if (!entry) return false;
        const entryServices = await prisma.queueEntryService.findMany({ where: { entryId }, select: { serviceId: true } });
        if (!allowManualOverride && entry.manualOverrideReason) return false;
        const serviceIds = entryServices.map((service) => service.serviceId);
        if (allowManualOverride && entry.manualOverrideReason) return true;
        const skills = await prisma.salonStaffSkill.count({
            where: { salonId: entry.salonId, membershipId: staffId, serviceId: { in: serviceIds } },
        });
        return skills === serviceIds.length;
    }

    async claimNextEntry(salonId: string, staffId: string): Promise<QueueEntry> {
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${salonId}, 0))`;
            const entry = await tx.queueEntry.findFirst({
                where: { salonId, status: 'WAITING' },
                orderBy: [{ priority: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
            });
            if (!entry) throw new Error('No customers waiting in queue');
            const services = await tx.queueEntryService.findMany({
                where: { entryId: entry.id, salonId },
                select: { serviceId: true },
            });
            if (!services.length) throw new Error('Queue entry has no service');
            const overrideAllowed = Boolean(entry.manualOverrideReason);
            if (!overrideAllowed) {
                const qualifiedCount = await tx.salonStaffSkill.count({
                    where: { salonId, membershipId: staffId, serviceId: { in: services.map((service) => service.serviceId) } },
                });
                if (qualifiedCount !== services.length) {
                    throw new Error('Stylist is not qualified for every service in this queue entry');
                }
            }
            const claimed = await tx.queueEntry.updateMany({
                where: { id: entry.id, salonId, status: 'WAITING' },
                data: {
                    status: 'IN_PROGRESS',
                    actualStartTime: new Date(),
                    scheduleVersion: { increment: 1 },
                    lastRecalculatedAt: new Date(),
                },
            });
            if (claimed.count !== 1) throw new Error('Queue entry changed concurrently; retry the operation');
            await tx.queueEntryStaff.createMany({
                data: services.map((service) => ({
                    entryId: entry.id,
                    salonId,
                    membershipId: staffId,
                    serviceId: service.serviceId,
                    actualStart: new Date(),
                    status: 'IN_PROGRESS',
                })),
                skipDuplicates: true,
            });
            return {
                id: entry.id,
                userId: entry.customerAccountId,
                salonId: entry.salonId,
                serviceId: services[0].serviceId,
                entryTime: entry.arrivalTime ?? entry.createdAt,
                estimatedWaitTime: entry.estimatedDurationMinutes,
                status: 'IN_PROGRESS',
                priority: this.priorityLabel(entry.priority),
                position: entry.position,
                scheduleVersion: entry.scheduleVersion + 1,
                updatedAt: new Date(),
            };
        });
    }

    async updateStatus(entryId: string, status: QueueEntry['status'], staffId?: string, salonId?: string): Promise<void> {
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${salonId ?? entryId}, 0))`;
            const entry = await tx.queueEntry.findUnique({
                where: { id: entryId },
                select: { id: true, salonId: true, status: true },
            });
            if (!entry) throw new ApiError(404, 'Queue entry not found');
            if (salonId && entry.salonId !== salonId) throw new ApiError(404, 'Queue entry does not belong to salon');
            if (entry.status === status) return;
            if (!canTransitionQueueStatus(entry.status, status)) {
                throw new ApiError(409, `Invalid queue transition from ${entry.status} to ${status}`);
            }

            const changed = await tx.queueEntry.updateMany({
                where: { id: entryId, salonId: entry.salonId, status: entry.status },
                data: {
                    status,
                    actualStartTime: status === 'IN_PROGRESS' ? new Date() : undefined,
                    actualEndTime: status === 'COMPLETED' ? new Date() : undefined,
                    scheduleVersion: { increment: 1 },
                    lastRecalculatedAt: new Date(),
                },
            });
            if (changed.count !== 1) throw new Error('Queue entry changed concurrently; retry the operation');

            if (status === 'IN_PROGRESS' && staffId) {
                const services = await tx.queueEntryService.findMany({
                    where: { entryId },
                    select: { serviceId: true },
                });
                await tx.queueEntryStaff.createMany({
                    data: services.map(({ serviceId }) => ({
                        entryId,
                        salonId: entry.salonId,
                        membershipId: staffId,
                        serviceId,
                        actualStart: new Date(),
                        status: 'IN_PROGRESS',
                    })),
                    skipDuplicates: true,
                });
            }
        });
    }

    async getWaitingList(salonId: string): Promise<QueueEntry[]> {
        const rows = await prisma.$queryRaw<Array<QueueRow>>`
            WITH waiting AS (
                SELECT
                    entry.*,
                    COALESCE(
                        SUM(entry.estimated_duration_minutes) OVER (
                            ORDER BY entry.priority DESC, entry.position
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ),
                        0
                    ) AS estimated_wait_time
                FROM queue_entries AS entry
                WHERE entry.salon_id = ${salonId}
                  AND entry.status = 'WAITING'
            )
            SELECT
                entry.id,
                entry.customer_account_id AS "userId",
                entry.salon_id AS "salonId",
                service.service_id AS "serviceId",
                COALESCE(entry.arrival_time, entry.created_at) AS "entryTime",
                entry.estimated_wait_time AS "estimatedWaitTime",
                entry.status,
                CASE entry.priority
                    WHEN 100 THEN 'EMERGENCY'
                    WHEN 10 THEN 'VIP'
                    ELSE 'NORMAL'
                END AS priority,
                entry.position,
                entry.schedule_version AS "scheduleVersion",
                entry.updated_at AS "updatedAt"
            FROM waiting AS entry
            JOIN LATERAL (
                SELECT service_id
                FROM queue_entry_services
                WHERE entry_id = entry.id
                ORDER BY service_id
                LIMIT 1
            ) AS service ON TRUE
            ORDER BY entry.priority DESC, entry.position ASC
        `;
        return rows.map((row) => this.toQueueEntry(row));
    }

    async getUserPosition(userId: string, salonId: string): Promise<QueueEntry | null> {
        const rows = await prisma.$queryRaw<Array<QueueRow>>`
            WITH waiting AS (
                SELECT
                    entry.*,
                    COALESCE(
                        SUM(entry.estimated_duration_minutes) OVER (
                            ORDER BY entry.priority DESC, entry.position
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ),
                        0
                    ) AS estimated_wait_time
                FROM queue_entries AS entry
                WHERE entry.salon_id = ${salonId}
                  AND entry.status = 'WAITING'
            )
            SELECT
                entry.id,
                entry.customer_account_id AS "userId",
                entry.salon_id AS "salonId",
                service.service_id AS "serviceId",
                COALESCE(entry.arrival_time, entry.created_at) AS "entryTime",
                entry.estimated_wait_time AS "estimatedWaitTime",
                entry.status,
                CASE entry.priority
                    WHEN 100 THEN 'EMERGENCY'
                    WHEN 10 THEN 'VIP'
                    ELSE 'NORMAL'
                END AS priority,
                entry.position,
                entry.schedule_version AS "scheduleVersion",
                entry.updated_at AS "updatedAt"
            FROM waiting AS entry
            JOIN LATERAL (
                SELECT service_id
                FROM queue_entry_services
                WHERE entry_id = entry.id
                ORDER BY service_id
                LIMIT 1
            ) AS service ON TRUE
            WHERE entry.customer_account_id = ${userId}
            LIMIT 1
        `;
        return rows[0] ? this.toQueueEntry(rows[0]) : null;
    }

    async getEntry(entryId: string): Promise<QueueEntry | null> {
        const entry = await prisma.queueEntry.findUnique({
            where: { id: entryId },
            select: {
                id: true,
                customerAccountId: true,
                salonId: true,
                position: true,
                status: true,
                priority: true,
                arrivalTime: true,
                createdAt: true,
                estimatedDurationMinutes: true,
                manualOverrideReason: true,
                scheduleVersion: true,
                updatedAt: true,
            },
        });
        if (!entry) return null;
        const entryService = await prisma.queueEntryService.findFirst({
            where: { entryId },
            select: { serviceId: true },
        });
        if (!entryService) return null;
        return {
            id: entry.id,
            userId: entry.customerAccountId,
            salonId: entry.salonId,
            serviceId: entryService.serviceId,
            entryTime: entry.arrivalTime ?? entry.createdAt,
            estimatedWaitTime: entry.estimatedDurationMinutes,
            status: entry.status as QueueEntry['status'],
            priority: this.priorityLabel(entry.priority),
            position: entry.position,
            manualOverrideReason: entry.manualOverrideReason ?? undefined,
            scheduleVersion: entry.scheduleVersion,
            updatedAt: entry.updatedAt,
        };
    }

    async reassignPositions(entries: QueueEntry[]): Promise<void> {
        if (entries.length === 0) return;
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
                SELECT pg_advisory_xact_lock(hashtextextended(${entries[0]?.salonId ?? ''}, 0))
            `;
            const maximum = await tx.queueEntry.aggregate({
                where: { salonId: entries[0]?.salonId, status: 'WAITING' },
                _max: { position: true },
            });
            let temporaryPosition = (maximum._max.position ?? 0) + 1;
            for (const entry of entries) {
                await tx.queueEntry.update({
                    where: { id: entry.id },
                    data: { position: temporaryPosition++ },
                });
            }
            for (const [index, entry] of entries.entries()) {
                await tx.queueEntry.update({
                    where: { id: entry.id },
                    data: {
                        position: index + 1,
                        scheduleVersion: { increment: 1 },
                        lastRecalculatedAt: new Date(),
                    },
                });
            }
        });
    }

    async getAdvancedPlanningSnapshot(salonId: string) {
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        const [hours, staffSkills, availability, activeShifts, leaveRequests, stylistStates, waitingEntries, bookingStaffAssignments, breakLogs] = await Promise.all([
            prisma.salonBusinessHours.findMany({ where: { salonId }, select: { dayOfWeek: true, isClosed: true, opensAt: true, closesAt: true } }),
            prisma.salonStaffSkill.findMany({ where: { salonId }, select: { membershipId: true, serviceId: true } }),
            prisma.salonStaffAvailability.findMany({ where: { salonId }, select: { membershipId: true, dayOfWeek: true, startsAt: true, endsAt: true, effectiveFrom: true, effectiveUntil: true } }),
            prisma.salonEmployeeShift.findMany({ where: { salonId, clockedOutAt: null }, select: { membershipId: true, clockedInAt: true } }),
            prisma.salonEmployeeLeaveRequest.findMany({
                where: { salonId, status: 'APPROVED', startsOn: { lte: new Date() }, endsOn: { gte: new Date() } },
                select: { membershipId: true, startsOn: true, endsOn: true },
            }),
            prisma.stylistState.findMany({ where: { salonId }, select: { membershipId: true, currentStatus: true, currentEntryId: true, nextBreakStart: true, breakDurationMinutes: true } }),
            prisma.queueEntry.findMany({
                where: { salonId, status: { in: ['WAITING', 'IN_PROGRESS'] } },
                orderBy: [{ priority: 'desc' }, { position: 'asc' }],
            }),
            prisma.customerBookingStaff.findMany({ where: { salonId }, select: { bookingId: true, membershipId: true, serviceId: true } }),
            prisma.salonBreakLog.findMany({ where: { salonId, actualStart: { gte: dayStart, lt: dayEnd } }, select: { membershipId: true, originalStart: true, actualStart: true } }),
        ]);
        const entryIds = waitingEntries.map((entry) => entry.id);
        const bookingIds = [...new Set(bookingStaffAssignments.map((assignment) => assignment.bookingId))];
        const [entryServices, entryStaff, bookings, bookingServices] = await Promise.all([
            prisma.queueEntryService.findMany({ where: { salonId, entryId: { in: entryIds } }, select: { entryId: true, serviceId: true, durationMinutes: true } }),
            prisma.queueEntryStaff.findMany({ where: { salonId, entryId: { in: entryIds } }, select: { entryId: true, membershipId: true, status: true } }),
            prisma.customerBooking.findMany({ where: { salonId, id: { in: bookingIds }, status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'PENDING'] }, appointmentAt: { gte: dayStart, lt: dayEnd } }, select: { id: true, appointmentAt: true, estimatedDurationMinutes: true } }),
            prisma.customerBookingService.findMany({ where: { salonId, bookingId: { in: bookingIds } }, select: { bookingId: true, serviceId: true, durationMinutes: true } }),
        ]);
        return { hours, staffSkills, availability, activeShifts, leaveRequests, stylistStates, waitingEntries, entryServices, entryStaff, bookings, bookingStaffAssignments, bookingServices, breakLogs };
    }

    async approveClosingRequest(requestId: string, actorAccountId: string, salonId: string, approve: boolean, note?: string): Promise<void> {
        await prisma.$transaction(async (tx) => {
            const request = await tx.queueClosingRequest.findFirst({ where: { id: requestId, salonId } });
            if (!request) throw new Error('Closing request not found');
            if (request.status !== 'PENDING') throw new Error('Closing request is already resolved');
            if (request.expiresAt.getTime() < Date.now()) {
                await tx.queueClosingRequest.update({ where: { id: requestId }, data: { status: 'EXPIRED', reviewedAt: new Date(), reviewedByAccountId: actorAccountId, reviewNote: 'Approval window expired' } });
                await tx.queueEntry.update({ where: { id: request.entryId }, data: { status: 'CANCELLED', ownerApprovedAfterHours: false, ownerApprovalExpiresAt: null } });
                throw new Error('Closing request approval window expired');
            }
            const status = approve ? 'APPROVED' : 'REJECTED';
            await tx.queueClosingRequest.update({ where: { id: requestId }, data: { status, reviewedAt: new Date(), reviewedByAccountId: actorAccountId, reviewNote: note } });
            await tx.queueEntry.update({
                where: { id: request.entryId },
                data: approve ? {
                    ownerApprovedAfterHours: true,
                    ownerApprovalExpiresAt: request.expiresAt,
                    scheduleVersion: { increment: 1 },
                } : {
                    ownerApprovedAfterHours: false,
                    ownerApprovalExpiresAt: null,
                    status: 'CANCELLED',
                },
            });
        });
    }

    async expireClosingRequests(): Promise<number> {
        return prisma.$transaction(async (tx) => {
            const expiredRequests = await tx.queueClosingRequest.findMany({
                where: { status: 'PENDING', expiresAt: { lt: new Date() } },
                select: { id: true, entryId: true },
            });
            if (expiredRequests.length === 0) return 0;
            await tx.queueClosingRequest.updateMany({
                where: { id: { in: expiredRequests.map((request) => request.id) } },
                data: { status: 'EXPIRED', reviewedAt: new Date(), reviewNote: 'Approval window expired' },
            });
            await tx.queueEntry.updateMany({
                where: { id: { in: expiredRequests.map((request) => request.entryId) } },
                data: { status: 'CANCELLED', ownerApprovedAfterHours: false, ownerApprovalExpiresAt: null },
            });
            return expiredRequests.length;
        }, { maxWait: 10_000, timeout: 30_000 });
    }

    async getPendingClosingRequests(salonId: string) {
        await prisma.$transaction(async (tx) => {
            const expiredRequests = await tx.queueClosingRequest.findMany({
                where: { salonId, status: 'PENDING', expiresAt: { lt: new Date() } },
                select: { id: true, entryId: true },
            });
            if (expiredRequests.length > 0) {
                await tx.queueClosingRequest.updateMany({ where: { id: { in: expiredRequests.map((request) => request.id) } }, data: { status: 'EXPIRED', reviewedAt: new Date(), reviewNote: 'Approval window expired' } });
                await tx.queueEntry.updateMany({ where: { id: { in: expiredRequests.map((request) => request.entryId) }, salonId }, data: { status: 'CANCELLED', ownerApprovedAfterHours: false, ownerApprovalExpiresAt: null } });
            }
        }, { maxWait: 10_000, timeout: 30_000 });
        return prisma.queueClosingRequest.findMany({ where: { salonId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
    }

    async createClosingRequest(entryId: string, salonId: string, requestedByAccountId: string, requestedStartAt: Date, requestedEndAt: Date): Promise<void> {
        await prisma.queueClosingRequest.create({
            data: {
                entryId,
                salonId,
                requestedByAccountId,
                requestedStartAt,
                requestedEndAt,
                expiresAt: new Date(Date.now() + 5 * 60_000),
            },
        });
    }

    async recordQueueOverride(entryId: string, salonId: string, reason: string, assignedStaffId: string | null, actorAccountId: string): Promise<void> {
        await prisma.$transaction(async (tx) => {
            await tx.queueConflictAlert.create({
                data: {
                    entryId,
                    reason: `MANUAL_OVERRIDE: ${reason}`,
                    status: 'RESOLVED',
                    resolution: 'MANUAL_OVERRIDE',
                    resolvedByAccountId: actorAccountId,
                    resolutionNotes: assignedStaffId ? `Assigned to staff ${assignedStaffId}` : reason,
                    resolvedAt: new Date(),
                },
            });
            await tx.queueEntry.update({
                where: { id: entryId },
                data: { manualOverrideReason: reason, scheduleVersion: { increment: 1 }, lastRecalculatedAt: new Date() },
            });
            if (assignedStaffId) {
                await tx.queueEntryStaff.updateMany({ where: { entryId, salonId }, data: { status: 'SUPERSEDED' } });
                const entryService = await tx.queueEntryService.findFirst({ where: { entryId, salonId }, select: { serviceId: true } });
                if (!entryService) throw new Error('Queue entry service not found');
                await tx.queueEntryStaff.create({
                    data: { entryId, salonId, membershipId: assignedStaffId, serviceId: entryService.serviceId, status: 'MANUAL_OVERRIDE' },
                });
            }
        });
    }

    async reportServiceOverrun(entryId: string, actualDurationMinutes: number): Promise<{ previousDurationMinutes: number }> {
        return prisma.$transaction(async (tx) => {
            const entry = await tx.queueEntry.findUniqueOrThrow({
                where: { id: entryId },
                select: { estimatedDurationMinutes: true },
            });
            await tx.queueEntry.update({
                where: { id: entryId },
                data: {
                    estimatedDurationMinutes: actualDurationMinutes,
                    scheduleVersion: { increment: 1 },
                    lastRecalculatedAt: new Date(),
                },
            });
            return { previousDurationMinutes: entry.estimatedDurationMinutes };
        });
    }

    async calculateSummary(salonId: string): Promise<QueueSummary> {
        const stats = await prisma.$queryRaw<Array<{ totalWaiting: number; averageWaitTime: number | null }>>`
            WITH waiting AS (
                SELECT
                    COALESCE(
                        SUM(entry.estimated_duration_minutes) OVER (
                            ORDER BY entry.priority DESC, entry.position
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ),
                        0
                    ) AS estimated_wait_time
                FROM queue_entries AS entry
                WHERE entry.salon_id = ${salonId}
                  AND entry.status = 'WAITING'
            )
            SELECT
                COUNT(*)::int AS "totalWaiting",
                COALESCE(AVG(estimated_wait_time), 0)::float AS "averageWaitTime"
            FROM waiting
        `;
        const nextEntries = await prisma.queueEntry.findMany({
            where: { salonId, status: 'WAITING' },
            orderBy: [{ priority: 'desc' }, { position: 'asc' }],
            take: 5,
            select: { customerAccountId: true },
        });
        return {
            salonId,
            totalWaiting: stats[0].totalWaiting,
            averageWaitTime: stats[0].averageWaitTime ?? 0,
            nextInLine: nextEntries.map(({ customerAccountId }) => customerAccountId),
        };
    }

    private priorityValue(priority: QueueEntry['priority']): number {
        switch (priority) {
            case 'EMERGENCY':
                return 100;
            case 'VIP':
                return 10;
            default:
                return 0;
        }
    }

    private priorityLabel(priority: number): QueueEntry['priority'] {
        if (priority >= 100) return 'EMERGENCY';
        if (priority >= 10) return 'VIP';
        return 'NORMAL';
    }

    private toQueueEntry(row: QueueRow): QueueEntry {
        return {
            ...row,
            status: row.status as QueueEntry['status'],
            priority: row.priority as QueueEntry['priority'],
        };
    }
}

interface QueueRow {
    id: string;
    userId: string;
    salonId: string;
    serviceId: string;
    entryTime: Date;
    estimatedWaitTime: number;
    status: string;
    priority: string;
    position: number;
    scheduleVersion?: number;
    updatedAt?: Date;
}
