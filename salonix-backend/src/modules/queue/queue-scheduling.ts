export interface QueueCandidate {
  id: string;
  durationMinutes: number;
  priority: 0 | 10 | 100;
  arrivalAt: Date;
  preferredAt?: Date;
  arrived: boolean;
  entryType?: 'APPOINTMENT' | 'WALK_IN';
  serviceIds?: string[];
  preferredStaffId?: string;
  maxWaitMinutes?: number;
  noShowGraceMinutes?: number;
  manualOverride?: { staffId?: string; reason: string; actorAccountId: string };
  ownerApprovedAfterHours?: boolean;
  ownerApprovalExpiresAt?: Date;
}

export interface QueueStaffResource {
  id: string;
  skillServiceIds: string[];
  availableFrom: Date;
  availableUntil: Date;
  unavailableUntil?: Date;
  currentEntryId?: string;
  checkedIn?: boolean;
  plannedAvailableAt?: Date;
  breakStart?: Date;
  breakEnd?: Date;
  occupiedIntervals?: Array<{ startsAt: Date; endsAt: Date; kind: 'APPOINTMENT' | 'SERVICE' | 'BREAK' }>;
}

export interface QueueScheduleItem extends QueueCandidate {
  position: number;
  assignedStaffId?: string;
  estimatedStartAt: Date;
  estimatedEndAt: Date;
  gapFilled: boolean;
  fallbackUsed: boolean;
  conflictCode?: 'STAFF_PREFERENCE_UNAVAILABLE' | 'SKILL_UNAVAILABLE' | 'OUTSIDE_SALON_HOURS' | 'STAFF_UNAVAILABLE' | 'MANUAL_OVERRIDE_REQUIRED' | 'CLOSING_CUTOFF_PENDING_APPROVAL' | 'CLOSING_CUTOFF_EXPIRED';
}

export interface QueueSchedulingInput {
  now: Date;
  candidates: QueueCandidate[];
  staff?: QueueStaffResource[];
  salonOpensAt?: Date;
  salonClosesAt?: Date;
  availableAt?: Date;
  slotMinutes?: number;
}

export interface QueueReplanResult {
  schedule: QueueScheduleItem[];
  conflicts: QueueScheduleItem[];
  requiresHumanReview: boolean;
}

const minute = 60_000;

export interface TimeEstimateUpdate {
  previousEstimatedStartAt: Date;
  nextEstimatedStartAt: Date;
  serverNow: Date;
  delayMinutes: number;
  shouldNotify: boolean;
  reason: 'ON_TRACK' | 'DELAYED' | 'SERVICE_FINISHED_EARLY' | 'TURN_READY';
  countdownSyncSeconds: 60;
  authoritativeRefreshSeconds: 300;
}

export function buildTimeEstimateUpdate(input: {
  previousEstimatedStartAt: Date;
  nextEstimatedStartAt: Date;
  serverNow: Date;
  status?: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  previousDelayMinutes?: number;
}): TimeEstimateUpdate {
  const previousTime = input.previousEstimatedStartAt.getTime();
  const nextTime = input.nextEstimatedStartAt.getTime();
  const delay = Math.max(0, Math.ceil((nextTime - Math.max(previousTime, input.serverNow.getTime())) / minute));
  const previousBucket = floorDelayBucket(input.previousDelayMinutes ?? 0);
  const nextBucket = floorDelayBucket(delay);
  const status = input.status;
  let reason: TimeEstimateUpdate['reason'] = 'ON_TRACK';
  if (status === 'IN_PROGRESS') reason = 'TURN_READY';
  else if (nextTime < previousTime) reason = 'SERVICE_FINISHED_EARLY';
  else if (nextTime > previousTime) reason = 'DELAYED';
  const materiallyChanged = nextBucket !== previousBucket || (reason === 'TURN_READY');
  return {
    previousEstimatedStartAt: input.previousEstimatedStartAt,
    nextEstimatedStartAt: input.nextEstimatedStartAt,
    serverNow: input.serverNow,
    delayMinutes: nextBucket,
    shouldNotify: materiallyChanged,
    reason,
    countdownSyncSeconds: 60,
    authoritativeRefreshSeconds: 300,
  };
}

export function floorDelayBucket(delayMinutes: number): number {
  return Math.max(0, Math.floor(delayMinutes / 5) * 5);
}

export function canTransitionQueueStatus(currentStatus: string, nextStatus: string): boolean {
  const allowedTransitions: Record<string, readonly string[]> = {
    WAITING: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  };
  return allowedTransitions[currentStatus]?.includes(nextStatus) === true;
}

export function buildQueueSchedule(input: QueueSchedulingInput): QueueScheduleItem[] {
  return buildQueuePlan(input).schedule;
}

export function buildQueuePlan(input: QueueSchedulingInput): QueueReplanResult {
  const ranked = [...input.candidates].sort(compareCandidates);
  const resources = (input.staff ?? []).map((staff) => ({
    ...staff,
    skillServiceIds: [...staff.skillServiceIds],
  }));
  const salonOpensAt = input.salonOpensAt ?? new Date(input.availableAt?.getTime() ?? input.now.getTime());
  const salonClosesAt = input.salonClosesAt ?? new Date(salonOpensAt.getTime() + 24 * 60 * minute);
  const availableAt = input.availableAt?.getTime() ?? Math.max(input.now.getTime(), salonOpensAt.getTime());
  const schedule: QueueScheduleItem[] = [];

  for (const [rankIndex, candidate] of ranked.entries()) {
    const serviceIds = candidate.serviceIds?.length ? candidate.serviceIds : candidate.id ? [candidate.id] : [];
    const manualStaffId = candidate.manualOverride?.staffId;
    let staff: QueueStaffResource | undefined;

    if (manualStaffId) {
      const manualStaff = resources.find((item) => item.id === manualStaffId);
      if (manualStaff) staff = manualStaff;
    } else {
      const isArrivalSensitive = candidate.arrived || candidate.entryType === 'WALK_IN';
      const eligible = resources.filter((item) =>
        serviceIds.every((serviceId) => item.skillServiceIds.includes(serviceId)) &&
        (!isArrivalSensitive || item.checkedIn !== false) &&
        (!isArrivalSensitive || !item.unavailableUntil || item.unavailableUntil.getTime() <= input.now.getTime())
      );
      if (candidate.preferredStaffId) {
        staff = eligible.find((item) => item.id === candidate.preferredStaffId);
      }
      if (!staff) staff = eligible.sort((left, right) => left.availableFrom.getTime() - right.availableFrom.getTime())[0];
    }

    let start = Math.max(salonOpensAt.getTime(), availableAt, input.now.getTime(), candidate.preferredAt?.getTime() ?? salonOpensAt.getTime());
    let conflictCode: QueueScheduleItem['conflictCode'];
    let fallbackUsed = false;

    if (candidate.arrived) {
      const graceEnd = candidate.arrivalAt.getTime() + (candidate.noShowGraceMinutes ?? 15) * minute;
      if (!candidate.preferredAt && input.now.getTime() > graceEnd && candidate.priority === 0) {
        start = input.now.getTime();
      }
    }

    if (staff) {
      start = Math.max(salonOpensAt.getTime(), start, staff.availableFrom.getTime(), staff.unavailableUntil?.getTime() ?? 0);
      if (candidate.arrived && staff.checkedIn === false) {
        start = Math.max(salonOpensAt.getTime(), staff.plannedAvailableAt?.getTime() ?? staff.availableFrom.getTime());
      }
      if (staff.breakStart && staff.breakEnd && start < staff.breakEnd.getTime() && start + candidate.durationMinutes * minute > staff.breakStart.getTime()) {
        start = staff.breakEnd.getTime();
      }
      start = findAvailableIntervalStart(start, candidate.durationMinutes, staff, input.now);
      if (candidate.preferredStaffId && !candidate.manualOverride && staff.id !== candidate.preferredStaffId) {
        conflictCode = 'STAFF_PREFERENCE_UNAVAILABLE';
        fallbackUsed = true;
      }
    } else {
      conflictCode = serviceIds.length > 0 ? 'SKILL_UNAVAILABLE' : 'STAFF_UNAVAILABLE';
      fallbackUsed = true;
    }

    if (manualStaffId && !staff) conflictCode = 'MANUAL_OVERRIDE_REQUIRED';
    if (start < salonOpensAt.getTime() || start >= salonClosesAt.getTime()) {
      conflictCode = 'OUTSIDE_SALON_HOURS';
    }

    let end = start + candidate.durationMinutes * minute;
    const pendingOwnerApproval = end > salonClosesAt.getTime() && candidate.ownerApprovedAfterHours !== true;
    const approvalExpired = candidate.ownerApprovedAfterHours === true && candidate.ownerApprovalExpiresAt !== undefined && candidate.ownerApprovalExpiresAt.getTime() < input.now.getTime();
    if (pendingOwnerApproval) conflictCode = 'CLOSING_CUTOFF_PENDING_APPROVAL';
    if (approvalExpired) conflictCode = 'CLOSING_CUTOFF_EXPIRED';
    if (end > salonClosesAt.getTime() && candidate.ownerApprovedAfterHours !== true) {
      end = salonClosesAt.getTime();
      start = Math.max(salonOpensAt.getTime(), end - candidate.durationMinutes * minute);
      if (start >= end) conflictCode = 'OUTSIDE_SALON_HOURS';
    }

    if (staff && end > staff.availableUntil.getTime() && candidate.ownerApprovedAfterHours !== true) {
      start = Math.max(start, staff.availableUntil.getTime() - candidate.durationMinutes * minute);
      end = start + candidate.durationMinutes * minute;
      if (start >= end || end > staff.availableUntil.getTime()) conflictCode = 'STAFF_UNAVAILABLE';
    }

    schedule.push({
      ...candidate,
      position: rankIndex + 1,
      assignedStaffId: staff?.id,
      estimatedStartAt: new Date(start),
      estimatedEndAt: new Date(end),
      gapFilled: Boolean(candidate.arrived && input.slotMinutes && candidate.durationMinutes <= input.slotMinutes),
      fallbackUsed,
      conflictCode,
    });

    if (staff && !conflictCode) {
      staff.availableFrom = new Date(Math.max(staff.availableFrom.getTime(), end));
      staff.occupiedIntervals = [...(staff.occupiedIntervals ?? []), { startsAt: new Date(start), endsAt: new Date(end), kind: 'SERVICE' }];
    }
  }

  const conflicts = schedule.filter((item) => item.conflictCode);
  return { schedule, conflicts, requiresHumanReview: conflicts.length > 0 };
}

function findAvailableIntervalStart(startMs: number, durationMinutes: number, staff: QueueStaffResource, now: Date): number {
  const durationMs = durationMinutes * minute;
  let candidateStart = Math.max(startMs, now.getTime());
  for (const interval of [...(staff.occupiedIntervals ?? [])].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())) {
    const intervalStart = interval.startsAt.getTime();
    const intervalEnd = interval.endsAt.getTime();
    const candidateEnd = candidateStart + durationMs;
    if (candidateEnd > intervalStart && candidateStart < intervalEnd) candidateStart = intervalEnd;
  }
  return Math.max(candidateStart, startMs);
}

export function calculateRippleImpact(
  originalDurationMinutes: number,
  newDurationMinutes: number,
  affectedEntryCount: number,
): number {
  const durationIncrease = Math.max(0, newDurationMinutes - originalDurationMinutes);
  return affectedEntryCount === 0 ? 0 : durationIncrease;
}

export function evaluateClosingAdmission(input: {
  requestedStartAt: Date;
  durationMinutes: number;
  salonClosesAt: Date;
  ownerApproval?: { approvedAt: Date; expiresAt: Date; approvedByAccountId: string };
  now?: Date;
}): { allowed: boolean; status: 'ALLOWED' | 'PENDING_OWNER_APPROVAL' | 'AUTO_REJECTED_AFTER_CUTOFF' } {
  const now = input.now ?? new Date();
  const requestedEndAt = input.requestedStartAt.getTime() + input.durationMinutes * minute;
  if (requestedEndAt <= input.salonClosesAt.getTime()) {
    return { allowed: true, status: 'ALLOWED' }; 
  }
  if (input.ownerApproval && input.ownerApproval.expiresAt.getTime() >= now.getTime()) {
    return { allowed: true, status: 'ALLOWED' };
  }
  if (input.ownerApproval && input.ownerApproval.expiresAt.getTime() < now.getTime()) {
    return { allowed: false, status: 'AUTO_REJECTED_AFTER_CUTOFF' };
  }
  if (input.requestedStartAt.getTime() <= input.salonClosesAt.getTime()) {
    return { allowed: false, status: 'PENDING_OWNER_APPROVAL' };
  }
  return { allowed: false, status: 'AUTO_REJECTED_AFTER_CUTOFF' };
}

export function calculateOverrunPlan(
  scheduledEndAt: Date,
  actualEndAt: Date,
  downstreamDurationMinutes: number,
): { delayMinutes: number; action: 'NONE' | 'NOTIFY' | 'RESCHEDULE_REQUIRED'; } {
  const delayMinutes = Math.max(0, Math.ceil((actualEndAt.getTime() - scheduledEndAt.getTime()) / minute));
  if (delayMinutes === 0) return { delayMinutes: 0, action: 'NONE' };
  if (downstreamDurationMinutes <= 0 || delayMinutes < 15) return { delayMinutes, action: 'NOTIFY' };
  return { delayMinutes, action: 'RESCHEDULE_REQUIRED' };
}

function compareCandidates(left: QueueCandidate, right: QueueCandidate): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.arrived !== right.arrived) return left.arrived ? -1 : 1;
  const leftTime = left.preferredAt?.getTime() ?? left.arrivalAt.getTime();
  const rightTime = right.preferredAt?.getTime() ?? right.arrivalAt.getTime();
  return leftTime - rightTime;
}
