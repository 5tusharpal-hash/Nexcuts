import { QueueRepository } from './queue.repository.js';
import { SocketService, QueueEvent } from '../../integrations/sockets/socket.service.js';
import { enqueueNotification } from '../../integrations/jobs/notification.worker.js';
import { logger } from '../../bootstrap/logger.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { buildQueuePlan, floorDelayBucket, QueueCandidate, QueueStaffResource } from './queue-scheduling.js';

export class QueueService {
    private readonly socket = new SocketService();

    constructor(private repository: QueueRepository) {}

    async joinQueue(
        userId: string,
        salonId: string,
        serviceId: string,
        priority: 'NORMAL' | 'VIP' | 'EMERGENCY' = 'NORMAL',
        marketingConsent?: boolean,
        preferredStaffId?: string,
        preferredTime?: Date,
        replaceQueueEntryId?: string,
        replaceBookingId?: string,
    ) {
        const entry = await this.repository.addToQueue({
            userId,
            salonId,
            serviceId,
            priority,
            marketingConsent,
            preferredStaffId,
            preferredTime,
            replaceQueueEntryId,
            replaceBookingId,
        });
        await this.socket.broadcastToBranch(salonId, QueueEvent.QUEUE_UPDATED, entry);
        await this.socket.sendToUser(userId, QueueEvent.QUEUE_UPDATED, this.createEstimateSync(entry, entry.estimatedWaitTime ?? entry.position));
        await this.enqueueCustomerUpdate(userId, salonId, `queue-joined:${entry.id}:${userId}`, 'You joined the salon queue',
            `Current position: ${entry.position}. Estimated wait: ${entry.estimatedWaitTime} minutes.`);
        return entry;
    }

    async callNextCustomer(actorAccountId: string, salonId: string, staffId: string) {
        const authorized = await this.repository.assertQueueAdmin(actorAccountId, salonId)
            || await this.repository.assertQueueStaffAssignment(actorAccountId, salonId, staffId);
        if (!authorized) throw new ApiError(403, 'Queue action access denied');
        let nextCustomer: Awaited<ReturnType<QueueRepository['claimNextEntry']>>;
        try {
            nextCustomer = await this.repository.claimNextEntry(salonId, staffId);
        } catch (error) {
            if (error instanceof Error && (error.message.includes('No customers waiting') || error.message.includes('not qualified'))) {
                throw new ApiError(409, error.message);
            }
            throw error;
        }
        await this.recalculateAndPublish(salonId);
        await this.socket.sendToUser(nextCustomer.userId, QueueEvent.STATUS_CHANGED, {
            entryId: nextCustomer.id,
            status: 'IN_PROGRESS',
            estimatedStartAt: new Date().toISOString(),
            serverTime: new Date().toISOString(),
            reason: 'TURN_READY',
        });
        await this.enqueueCustomerUpdate(nextCustomer.userId, salonId, `turn-ready:${nextCustomer.id}:${new Date().toISOString().slice(0, 16)}`,
            'Your turn is ready', 'Please proceed to your assigned stylist now.');
        return nextCustomer;
    }

    async leaveQueue(entryId: string) {
        const entry = await this.repository.getEntry(entryId);
        await this.repository.updateStatus(entryId, 'CANCELLED');
        if (entry) {
            await this.recalculateAndPublish(entry.salonId);
            await this.socket.sendToUser(entry.userId, QueueEvent.STATUS_CHANGED, {
                entryId,
                status: 'CANCELLED',
            });
            await this.enqueueCustomerUpdate(entry.userId, entry.salonId, `queue-cancelled:${entryId}`,
                'Queue booking cancelled', 'Your salon queue booking has been cancelled.');
        }
    }

    async markCompleted(actorAccountId: string, salonId: string, entryId: string) {
        const authorized = await this.repository.assertQueueAdmin(actorAccountId, salonId)
            || await this.repository.assertAssignedQueueStaff(actorAccountId, salonId, entryId);
        if (!authorized) throw new ApiError(403, 'Complete queue service access denied');
        await this.repository.updateStatus(entryId, 'COMPLETED', undefined, salonId);
        await this.recalculateAndPublish(salonId);
        const entry = await this.repository.getEntry(entryId);
        if (entry) {
            await this.socket.sendToUser(entry.userId, QueueEvent.STATUS_CHANGED, { entryId, status: 'COMPLETED' });
            await this.enqueueCustomerUpdate(entry.userId, salonId, `queue-completed:${entryId}`,
                'Service completed', 'Thank you for visiting. Your service has been completed.');
        }
        return { entryId, status: 'COMPLETED' };
    }

    async markNoShow(actorAccountId: string, salonId: string, entryId: string) {
        if (!await this.repository.assertQueueAdmin(actorAccountId, salonId)) throw new ApiError(403, 'No-show action requires owner or manager access');
        await this.repository.updateStatus(entryId, 'NO_SHOW', undefined, salonId);
        await this.recalculateAndPublish(salonId);
        const entry = await this.repository.getEntry(entryId);
        if (entry) {
            await this.socket.sendToUser(entry.userId, QueueEvent.STATUS_CHANGED, { entryId, status: 'NO_SHOW' });
            await this.enqueueCustomerUpdate(entry.userId, salonId, `queue-no-show:${entryId}`,
                'Queue booking marked as no-show', 'Please contact the salon if you still need assistance.');
        }
        return { entryId, status: 'NO_SHOW' };
    }

    async getMyPosition(userId: string, salonId: string) {
        const position = await this.repository.getUserPosition(userId, salonId);
        return position ? { ...position, ...this.createEstimateSync(position, position.estimatedWaitTime) } : null;
    }

    async getEntry(entryId: string) {
        return this.repository.getEntry(entryId);
    }

    async getAdvancedPlan(actorAccountId: string, salonId: string) {
        if (!await this.repository.assertSalonAccess(actorAccountId, salonId)) {
            throw new ApiError(403, 'Salon queue access denied');
        }
        const snapshot = await this.repository.getAdvancedPlanningSnapshot(salonId);
        const now = new Date();
        const dayOfWeek = now.getDay();
        const dayHours = snapshot.hours.find((hours) => hours.dayOfWeek === dayOfWeek);
        const opensAt = this.combineSalonTime(now, dayHours?.opensAt, 9, 0);
        const closesAt = this.combineSalonTime(now, dayHours?.closesAt, 21, 0);
        const staffIds = [...new Set(snapshot.staffSkills.map((skill) => skill.membershipId))];
        const bookingById = new Map(snapshot.bookings.map((booking) => [booking.id, booking]));
        const staff: QueueStaffResource[] = staffIds.map((membershipId) => {
            const skillServiceIds = snapshot.staffSkills.filter((skill) => skill.membershipId === membershipId).map((skill) => skill.serviceId);
            const availability = snapshot.availability.find((item) => item.membershipId === membershipId && item.dayOfWeek === dayOfWeek);
            const activeShift = snapshot.activeShifts.find((item) => item.membershipId === membershipId);
            const onLeave = snapshot.leaveRequests.some((item) => item.membershipId === membershipId);
            const plannedAvailableAt = this.combineSalonTime(now, availability?.startsAt, 9, 0);
            const checkedIn = Boolean(activeShift);
            const availableFrom = checkedIn ? new Date(Math.max(opensAt.getTime(), activeShift!.clockedInAt.getTime())) : new Date(Math.max(opensAt.getTime(), plannedAvailableAt.getTime()));
            const availableUntil = availability ? this.combineSalonTime(now, availability.endsAt, 21, 0) : closesAt;
            const stylistState = snapshot.stylistStates.find((item) => item.membershipId === membershipId);
            const appointmentIntervals = snapshot.bookingStaffAssignments
                .filter((assignment) => assignment.membershipId === membershipId)
                .map((assignment) => bookingById.get(assignment.bookingId))
                .filter((booking) => Boolean(booking))
                .map((booking) => ({
                    startsAt: booking!.appointmentAt,
                    endsAt: new Date(booking!.appointmentAt.getTime() + booking!.estimatedDurationMinutes * 60_000),
                    kind: 'APPOINTMENT' as const,
                }));
            const breakIntervals = snapshot.breakLogs
                .filter((entry) => entry.membershipId === membershipId)
                .flatMap((entry) => {
                    const startsAt = entry.actualStart ?? entry.originalStart;
                    return startsAt ? [{ startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), kind: 'BREAK' as const }] : [];
                });
            if (stylistState?.nextBreakStart && stylistState.breakDurationMinutes) {
                breakIntervals.push({
                    startsAt: stylistState.nextBreakStart,
                    endsAt: new Date(stylistState.nextBreakStart.getTime() + stylistState.breakDurationMinutes * 60_000),
                    kind: 'BREAK',
                });
            }
            const inProgressIntervals = snapshot.entryStaff
                .filter((assignment) => assignment.membershipId === membershipId)
                .map((assignment) => snapshot.waitingEntries.find((entry) => entry.id === assignment.entryId && entry.status === 'IN_PROGRESS'))
                .filter((entry) => Boolean(entry))
                .map((entry) => {
                    const startsAt = entry!.actualStartTime ?? entry!.scheduledStartAt ?? now;
                    return { startsAt, endsAt: new Date(startsAt.getTime() + entry!.estimatedDurationMinutes * 60_000), kind: 'SERVICE' as const };
                });
            return {
                id: membershipId,
                skillServiceIds,
                checkedIn,
                plannedAvailableAt,
                availableFrom: onLeave ? closesAt : availableFrom,
                availableUntil,
                unavailableUntil: onLeave ? closesAt : undefined,
                breakStart: stylistState?.nextBreakStart ?? undefined,
                breakEnd: stylistState?.nextBreakStart && stylistState.breakDurationMinutes ? new Date(stylistState.nextBreakStart.getTime() + stylistState.breakDurationMinutes * 60_000) : undefined,
                occupiedIntervals: [...appointmentIntervals, ...breakIntervals, ...inProgressIntervals],
            };
        });
        const servicesByEntry = new Map<string, string[]>();
        const preferredStaffByEntry = new Map<string, string>();
        const manualOverrideStaffByEntry = new Map<string, string>();
        for (const service of snapshot.entryServices) servicesByEntry.set(service.entryId, [...(servicesByEntry.get(service.entryId) ?? []), service.serviceId]);
        for (const assignment of snapshot.entryStaff) {
            if (assignment.status === 'MANUAL_OVERRIDE') manualOverrideStaffByEntry.set(assignment.entryId, assignment.membershipId);
            if (assignment.status === 'PREFERRED' || assignment.status === 'ASSIGNED' || assignment.status === 'SCHEDULED') {
                preferredStaffByEntry.set(assignment.entryId, assignment.membershipId);
            }
        }
        const candidates: QueueCandidate[] = snapshot.waitingEntries.map((entry) => ({
            id: entry.id,
            durationMinutes: entry.estimatedDurationMinutes,
            priority: entry.priority === 100 ? 100 : entry.priority === 10 ? 10 : 0,
            arrivalAt: entry.arrivalTime ?? entry.createdAt,
            preferredAt: entry.preferredTime ?? undefined,
            arrived: Boolean(entry.arrivalTime && entry.arrivalTime.getTime() <= now.getTime()),
            entryType: entry.entryType === 'APPOINTMENT' ? 'APPOINTMENT' : 'WALK_IN',
            serviceIds: servicesByEntry.get(entry.id) ?? [],
            preferredStaffId: preferredStaffByEntry.get(entry.id),
            ownerApprovedAfterHours: entry.ownerApprovedAfterHours,
            ownerApprovalExpiresAt: entry.ownerApprovalExpiresAt ?? undefined,
            manualOverride: entry.manualOverrideReason ? {
                staffId: manualOverrideStaffByEntry.get(entry.id),
                reason: entry.manualOverrideReason,
                actorAccountId: 'SYSTEM_RECORDED_OVERRIDE',
            } : undefined,
            maxWaitMinutes: entry.preferredTime ? 20 : undefined,
        }));
        const plan = buildQueuePlan({ now, salonOpensAt: opensAt, salonClosesAt: closesAt, staff, candidates });
        await this.socket.broadcastToBranch(salonId, QueueEvent.QUEUE_UPDATED, plan);
        return plan;
    }

    async getClosingRequests(actorAccountId: string, salonId: string) {
        if (!await this.repository.assertQueueAdmin(actorAccountId, salonId)) throw new ApiError(403, 'Queue admin access denied');
        return this.repository.getPendingClosingRequests(salonId);
    }

    async decideClosingRequest(actorAccountId: string, salonId: string, requestId: string, approved: boolean, note?: string) {
        if (!await this.repository.assertQueueAdmin(actorAccountId, salonId)) throw new ApiError(403, 'Queue admin access denied');
        await this.repository.approveClosingRequest(requestId, actorAccountId, salonId, approved, note);
        await this.recalculateAndPublish(salonId);
        return { requestId, status: approved ? 'APPROVED' : 'REJECTED' };
    }

    async overrideAssignment(actorAccountId: string, salonId: string, entryId: string, staffId: string | null, reason: string) {
        if (!await this.repository.assertQueueAdmin(actorAccountId, salonId)) {
            throw new ApiError(403, 'Queue assignment override requires owner or manager access');
        }
        await this.repository.recordQueueOverride(entryId, salonId, reason, staffId, actorAccountId);
        await this.socket.broadcastToBranch(salonId, QueueEvent.QUEUE_UPDATED, { entryId, assignedStaffId: staffId, manualOverride: true });
        return this.getAdvancedPlan(actorAccountId, salonId);
    }

    async reportServiceOverrun(actorAccountId: string, salonId: string, entryId: string, actualDurationMinutes: number) {
        const authorized = await this.repository.assertQueueAdmin(actorAccountId, salonId)
            || await this.repository.assertAssignedQueueStaff(actorAccountId, salonId, entryId);
        if (!authorized) throw new ApiError(403, 'Service overrun access denied');
        const { previousDurationMinutes } = await this.repository.reportServiceOverrun(entryId, actualDurationMinutes);
        const snapshot = await this.repository.getAdvancedPlanningSnapshot(salonId);
        const delay = Math.max(0, actualDurationMinutes - previousDurationMinutes);
        const delayBucket = floorDelayBucket(delay);
        await this.socket.broadcastToBranch(salonId, QueueEvent.TIME_SHIFTED, { entryId, delayMinutes: delay, notifyDelayMinutes: delayBucket });
        if (delayBucket >= 5) {
            await Promise.all(snapshot.waitingEntries.map((waitingEntry) =>
                this.enqueueCustomerUpdate(waitingEntry.customerAccountId, salonId,
                    `queue-delay:${waitingEntry.id}:${delayBucket}`,
                    'Your estimated wait changed', `Your queue estimate is running approximately ${delayBucket} minutes late.`)
            ));
        }
        return { entryId, delayMinutes: delay, affectedCustomers: Math.max(0, snapshot.waitingEntries.length - 1) };
    }

    private createEstimateSync(entry: any, estimatedWaitMinutes: number | null | undefined, position?: number) {
        const serverNow = new Date();
        const waitMinutes = Math.max(0, estimatedWaitMinutes ?? 0);
        return {
            entryId: entry.id,
            position: position ?? entry.position,
            estimatedWaitMinutes: waitMinutes,
            estimatedStartAt: new Date(serverNow.getTime() + waitMinutes * 60_000).toISOString(),
            serverTime: serverNow.toISOString(),
            countdownSyncSeconds: 60,
            authoritativeRefreshSeconds: 300,
            delayNotificationThresholdMinutes: 5,
            scheduleRevision: `${entry.id}:v${entry.scheduleVersion ?? 0}:${entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : entry.updatedAt ?? '0'}`,
        };
    }

    private combineSalonTime(now: Date, value: Date | null | undefined, fallbackHour: number, fallbackMinute: number): Date {
        const result = new Date(now);
        if (!value) {
            result.setHours(fallbackHour, fallbackMinute, 0, 0);
            return result;
        }
        result.setHours(value.getHours(), value.getMinutes(), 0, 0);
        return result;
    }

    private async recalculateAndPublish(salonId: string): Promise<void> {
        const entries = await this.repository.getWaitingList(salonId);
        await this.repository.reassignPositions(entries);
        await this.socket.broadcastToBranch(salonId, QueueEvent.QUEUE_UPDATED, { entries });
        await Promise.all(entries.map((entry, index) =>
            this.socket.sendToUser(entry.userId, QueueEvent.TIME_SHIFTED,
                this.createEstimateSync(entry, entry.estimatedWaitTime, index + 1))
        ));
    }

    private async enqueueCustomerUpdate(
        accountId: string,
        salonId: string,
        eventId: string,
        title: string,
        body: string,
    ): Promise<void> {
        try {
            await enqueueNotification({
                eventId,
                accountId,
                salonId,
                title,
                body,
                priority: 'HIGH',
                metadata: { sourceEventId: eventId },
            });
        } catch (error) {
            logger.warn({ error, accountId, salonId }, 'Queue notification could not be queued');
        }
    }
}
