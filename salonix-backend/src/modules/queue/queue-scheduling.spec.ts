import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQueuePlan, buildQueueSchedule, buildTimeEstimateUpdate, calculateOverrunPlan, evaluateClosingAdmission, calculateRippleImpact, canTransitionQueueStatus } from './queue-scheduling.js';

const now = new Date('2026-11-01T10:00:00.000Z');

function candidate(id: string, durationMinutes: number, priority: 0 | 10 | 100 = 0, arrived = true) {
  return { id, durationMinutes, priority, arrivalAt: now, arrived };
}

test('queue schedule prioritizes emergency and then arrived customers fairly', () => {
  const schedule = buildQueueSchedule({
    now,
    availableAt: now,
    candidates: [candidate('normal', 30), candidate('emergency', 20, 100), candidate('vip', 25, 10)],
  });
  assert.deepEqual(schedule.map((item) => item.id), ['emergency', 'vip', 'normal']);
});

test('queue schedule preserves arrival order within the same priority', () => {
  const earlier = { ...candidate('earlier', 20), arrivalAt: new Date('2026-11-01T09:00:00.000Z') };
  const later = { ...candidate('later', 20), arrivalAt: new Date('2026-11-01T09:30:00.000Z') };
  const schedule = buildQueueSchedule({ now, availableAt: now, candidates: [later, earlier] });
  assert.deepEqual(schedule.map((item) => item.id), ['earlier', 'later']);
});

test('gap filler identifies only a waiting customer that fits the available slot', () => {
  const schedule = buildQueueSchedule({
    now,
    availableAt: now,
    slotMinutes: 25,
    candidates: [candidate('small', 20), candidate('large', 40)],
  });
  assert.equal(schedule[0].gapFilled, true);
  assert.equal(schedule[1].gapFilled, false);
});

test('service add-on ripple impact is the duration increase', () => {
  assert.equal(calculateRippleImpact(30, 50, 3), 20);
  assert.equal(calculateRippleImpact(50, 30, 3), 0);
});

test('qualified fallback is selected when a preferred stylist is unavailable', () => {
  const plan = buildQueuePlan({
    now,
    salonOpensAt: now,
    salonClosesAt: new Date(now.getTime() + 8 * 60 * 60_000),
    staff: [{
      id: 'preferred', skillServiceIds: ['hair'], availableFrom: now, availableUntil: new Date(now.getTime() + 8 * 60 * 60_000), unavailableUntil: new Date(now.getTime() + 60 * 60_000),
    }, {
      id: 'available', skillServiceIds: ['hair'], availableFrom: now, availableUntil: new Date(now.getTime() + 8 * 60 * 60_000),
    }],
    candidates: [{ ...candidate('hair-service', 30), serviceIds: ['hair'], preferredStaffId: 'off-duty' }],
  });
  assert.equal(plan.schedule[0].assignedStaffId, 'available');
  assert.equal(plan.schedule[0].fallbackUsed, true);
});

test('multi-service booking requires every requested service skill', () => {
  const plan = buildQueuePlan({
    now,
    salonOpensAt: now,
    salonClosesAt: new Date(now.getTime() + 8 * 60 * 60_000),
    staff: [{ id: 'partial', skillServiceIds: ['hair'], availableFrom: now, availableUntil: new Date(now.getTime() + 8 * 60 * 60_000) }],
    candidates: [{ ...candidate('multi-service', 30), serviceIds: ['hair', 'color'] }],
  });
  assert.equal(plan.schedule[0].assignedStaffId, undefined);
  assert.equal(plan.schedule[0].conflictCode, 'SKILL_UNAVAILABLE');
});

test('existing appointment occupancy moves a walk-in after the occupied interval', () => {
  const plan = buildQueuePlan({
    now,
    salonOpensAt: now,
    salonClosesAt: new Date(now.getTime() + 8 * 60 * 60_000),
    staff: [{
      id: 'stylist', skillServiceIds: ['hair'], availableFrom: now,
      availableUntil: new Date(now.getTime() + 8 * 60 * 60_000),
      occupiedIntervals: [{ startsAt: now, endsAt: new Date(now.getTime() + 45 * 60_000), kind: 'APPOINTMENT' }],
    }],
    candidates: [{ ...candidate('hair', 30), serviceIds: ['hair'] }],
  });
  assert.equal(plan.schedule[0].estimatedStartAt.getTime(), now.getTime() + 45 * 60_000);
});

test('floating break shifts a schedule past the break window', () => {
  const breakEnd = new Date(now.getTime() + 90 * 60_000);
  const plan = buildQueuePlan({
    now,
    salonOpensAt: now,
    salonClosesAt: new Date(now.getTime() + 8 * 60 * 60_000),
    staff: [{
      id: 'stylist', skillServiceIds: ['hair'], availableFrom: now,
      availableUntil: new Date(now.getTime() + 8 * 60 * 60_000),
      breakStart: new Date(now.getTime() + 60 * 60_000), breakEnd,
    }],
    candidates: [{ ...candidate('hair', 45), serviceIds: ['hair'] }],
  });
  assert.equal(plan.schedule[0].estimatedStartAt.getTime(), now.getTime());
});

test('overrun beyond fifteen minutes requires rescheduling', () => {
  assert.equal(calculateOverrunPlan(now, new Date(now.getTime() + 20 * 60_000), 5).action, 'RESCHEDULE_REQUIRED');
});

test('employee arrival before opening never schedules a customer before salon opening', () => {
  const opening = new Date('2026-11-01T09:00:00.000Z');
  const plan = buildQueuePlan({
    now: new Date('2026-11-01T08:30:00.000Z'),
    salonOpensAt: opening,
    salonClosesAt: new Date('2026-11-01T21:00:00.000Z'),
    staff: [{ id: 'early-staff', skillServiceIds: ['hair'], availableFrom: new Date('2026-11-01T08:30:00.000Z'), availableUntil: new Date('2026-11-01T17:00:00.000Z') }],
    candidates: [{ ...candidate('hair'), serviceIds: ['hair'], preferredAt: new Date('2026-11-01T08:45:00.000Z') }],
  });
  assert.equal(plan.schedule[0].estimatedStartAt.getTime(), opening.getTime());
});

test('closing cutoff requires owner approval when service can finish after closing', () => {
  const admission = evaluateClosingAdmission({
    requestedStartAt: new Date('2026-11-01T20:45:00.000Z'), durationMinutes: 30,
    salonClosesAt: new Date('2026-11-01T21:00:00.000Z'), now,
  });
  assert.deepEqual(admission, { allowed: false, status: 'PENDING_OWNER_APPROVAL' });
});

test('unclocked staff wait does not delay the live walk-in schedule to staff scheduled shift time', () => {
  const salonOpening = new Date('2026-11-01T09:00:00.000Z');
  const plan = buildQueuePlan({
    now: salonOpening,
    salonOpensAt: salonOpening,
    salonClosesAt: new Date('2026-11-01T21:00:00.000Z'),
    staff: [{ id: 'late-staff', skillServiceIds: ['hair'], checkedIn: false, plannedAvailableAt: new Date('2026-11-01T09:30:00.000Z'), availableFrom: new Date('2026-11-01T09:30:00.000Z'), availableUntil: new Date('2026-11-01T17:00:00.000Z') }],
    candidates: [{ ...candidate('hair'), arrived: true, entryType: 'WALK_IN', serviceIds: ['hair'] }],
  });
  assert.equal(plan.schedule[0].assignedStaffId, undefined);
});

test('appointment forecast keeps preferred staff assignment before actual check-in', () => {
  const salonOpening = new Date('2026-11-01T09:00:00.000Z');
  const plan = buildQueuePlan({
    now: salonOpening,
    salonOpensAt: salonOpening,
    salonClosesAt: new Date('2026-11-01T21:00:00.000Z'),
    staff: [{ id: 'scheduled-staff', skillServiceIds: ['hair'], checkedIn: false, plannedAvailableAt: salonOpening, availableFrom: salonOpening, availableUntil: new Date('2026-11-01T17:00:00.000Z') }],
    candidates: [{ ...candidate('hair'), arrived: false, entryType: 'APPOINTMENT', preferredStaffId: 'scheduled-staff', serviceIds: ['hair'] }],
  });
  assert.equal(plan.schedule[0].assignedStaffId, 'scheduled-staff');
});

test('estimate sync does not notify for a delay below five minutes', () => {
  const serverNow = new Date('2026-11-01T15:00:00.000Z');
  const update = buildTimeEstimateUpdate({
    previousEstimatedStartAt: new Date('2026-11-01T15:30:00.000Z'),
    nextEstimatedStartAt: new Date('2026-11-01T15:33:00.000Z'),
    serverNow,
    previousDelayMinutes: 0,
  });
  assert.equal(update.shouldNotify, false);
  assert.equal(update.authoritativeRefreshSeconds, 300);
});

test('estimate sync notifies when delay crosses a five-minute bucket', () => {
  const serverNow = new Date('2026-11-01T15:00:00.000Z');
  const update = buildTimeEstimateUpdate({
    previousEstimatedStartAt: new Date('2026-11-01T15:30:00.000Z'),
    nextEstimatedStartAt: new Date('2026-11-01T15:36:00.000Z'),
    serverNow,
    previousDelayMinutes: 0,
  });
  assert.equal(update.shouldNotify, true);
  assert.equal(update.delayMinutes, 5);
});

test('estimate sync marks a customer turn as immediately ready', () => {
  const serverNow = new Date('2026-11-01T15:00:00.000Z');
  const update = buildTimeEstimateUpdate({
    previousEstimatedStartAt: new Date('2026-11-01T15:30:00.000Z'),
    nextEstimatedStartAt: new Date('2026-11-01T15:00:00.000Z'),
    serverNow,
    status: 'IN_PROGRESS',
  });
  assert.equal(update.shouldNotify, true);
  assert.equal(update.reason, 'TURN_READY');
});

test('queue lifecycle rejects terminal-state and backward transitions', () => {
  assert.equal(canTransitionQueueStatus('WAITING', 'IN_PROGRESS'), true);
  assert.equal(canTransitionQueueStatus('IN_PROGRESS', 'COMPLETED'), true);
  assert.equal(canTransitionQueueStatus('WAITING', 'COMPLETED'), false);
  assert.equal(canTransitionQueueStatus('COMPLETED', 'WAITING'), false);
  assert.equal(canTransitionQueueStatus('CANCELLED', 'IN_PROGRESS'), false);
});

test('approved closing request expires and cannot be accepted later', () => {
  const admission = evaluateClosingAdmission({
    requestedStartAt: new Date('2026-11-01T20:45:00.000Z'), durationMinutes: 30,
    salonClosesAt: new Date('2026-11-01T21:00:00.000Z'), now,
    ownerApproval: { approvedAt: new Date('2026-11-01T09:00:00.000Z'), approvedByAccountId: 'owner', expiresAt: new Date('2026-11-01T09:05:00.000Z') },
  });
  assert.equal(admission.status, 'AUTO_REJECTED_AFTER_CUTOFF');
});
