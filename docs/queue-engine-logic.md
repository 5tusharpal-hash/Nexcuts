# Intelligent Queue & Resource Orchestration System (IQROS)

## 1. Overview
The IQROS is not a traditional FIFO (First-In-First-Out) queue. It is a **Constraint-Based Resource Orchestrator** designed to handle the chaotic nature of a high-end salon. It manages the intersection of Fixed-Window Appointments, Dynamic Walk-ins, and Resource (Stylist) availability.

The core philosophy is **"Best-Effort Scheduling"**: The system attempts to honor preferred times but acknowledges that real-world salon operations are fluid.

---

## 2. Core Design Decisions & Intuition

### 2.1 Hybrid Queueing (Appointments + Walk-ins)
**Decision**: Merge appointments and walk-ins into a single sequence per stylist.
**Intuition**: A salon cannot have two separate lines. If a stylist is free, they should take the next eligible person regardless of how they entered the system.
**Impact**: Allows "Gap Filling." If an appointment is at 5 PM and the current time is 3 PM, the system identifies the 2-hour gap and fills it with walk-ins or earlier appointments.

### 2.2 Floating Break System
**Decision**: Breaks (Lunch/Tea) are treated as "Floating Windows" rather than fixed calendar blocks.
**Intuition**: In a real salon, if a stylist starts a complex 80-minute service at 1:00 PM, they cannot simply stop for lunch at 1:30 PM. The break must shift.
**Impact**: 
- Breaks automatically shift forward if a service overruns.
- System blocks new online bookings 30 minutes before the *current* estimated break start to ensure stylists actually get their break.

### 2.3 Impact Analysis for Human Intervention
**Decision**: The system provides "Impact Data" instead of making autonomous destructive changes.
**Intuition**: Adding a service or shifting a customer can cause a ripple effect of delays. A human manager is better at communicating this to a customer than a machine is at calculating it.
**Impact**: When a manager adds a service, the system reports: *"This will delay 3 customers by 20 minutes."* The manager then decides whether to proceed or negotiate with the customers.

### 2.4 Emergency Re-routing Logic
**Decision**: Re-routing follows a strict hierarchy: **Arrival Status $\rightarrow$ Booking Timestamp $\rightarrow$ Customer Choice.**
**Intuition**: If Stylist A leaves suddenly, the customers they were supposed to serve are the most disadvantaged. Fairness must be restored.
**Impact**:
1. Customers already in the shop (Arrived) get priority.
2. Between two arrived customers, the one who booked first wins.
3. If a customer explicitly chose a specific stylist, the system flags this as a conflict for the manager to resolve.

---

## 3. System Constraints & Rules

| Constraint | Rule | Logic |
|---|---|---|
| **The "No-Jump" Rule** | No priority for early arrival | Coming early doesn't grant a jump in queue. Position is based on assigned/preferred time. |
| **Booking Guardrail** | Break-window Blocking | Online bookings are disabled 30m before and during the estimated break window. |
| **Service Add-ons** | Sequence Push | Adding a service increases `estimated_duration`, pushing all subsequent entries forward. |
| **Preferred Time** | Estimate, not Guarantee | Preferred times are treated as targets. Significant deviations trigger `ConflictAlerts` for the owner. |

---

## 4. Data Requirements for Future Scaling

To evolve this system, the following data points are critical:
- **Service Duration Matrix**: Accurate average times per service to improve "Gap Filling" precision.
- **Stylist Skill Mapping**: To ensure "Eligibility" during emergency re-routing.
- **Customer Loyalty Tiers**: Potential future implementation for VIP priority in the queue.

---

## 5. Workflow Summary for Agents
When modifying the Queue Engine:
1. **Check the Ripple Effect**: Any change to one entry's duration must trigger a re-calculation of all subsequent entries in that stylist's queue.
2. **Respect the Break**: Always check if the proposed change overlaps with the `next_break_start`.
3. **Notify the Owner**: Any shift in `preferred_time` exceeding 15-20 minutes must create a `conflict_alert`.
