# Service & Staff Management Logic (FINAL)

## 1. Service Architecture (The Catalog)
The Service module is the foundational data source for both the Booking Interface and the Queue Engine.

### 1.1 Service Definition
- **Duration**: Primary input for the Queue Engine. used to calculate gaps and push-forwards.
- **Target Audience**: `MEN`, `WOMEN`, `KIDS`, or `UNISEX`. Filters stylist eligibility.
- **Visibility**: `is_public` flag controls if the service is listed on the public booking page.

### 1.2 Automation & Reminders
- **Reminder Window**: Configurable days (e.g., 30) to trigger a repeat visit notification.
- **Logic**: `Last_Visit_Date + Reminder_Window = Notification_Date`.

### 1.3 Professional Inventory Integration
Services may be linked to separate salon-use products for estimated usage reporting.
- **Non-Blocking**: Services work normally without linked consumables.
- **Separate Stock Pools**: Salon-use supplies and retail goods are separate product
  records and stock pools, even when they are the same real-world item.
- **Estimated Usage**: A service mapping records theoretical ML/gram/unit usage
  against a confirmed POS service line. Estimates do not deduct physical stock.
- **Whole-Unit Handover**: Bottles and packs are issued to a stylist or shared floor.
  Empty, return, damage, loss, and waste events are recorded separately.
- **Explicit Batch Selection**: Stock movements use the batch selected by salon staff.
  The system does not select batches automatically by FIFO or FEFO.
- **Restocking**: Low-stock alerts are optional per product.

### 1.4 Asynchronous Concurrent Services (Parallel Work)
The system supports multiple stylists working on one customer.
- **Staggered Start**: Services do not need to start simultaneously. Stylist A can start, and Stylist B can join later when free.
- **Total Occupancy**: Customer is occupied from the first stylist's start to the last stylist's end.
- **Human-in-the-Loop (HITL)**: If a perfect fit isn't found, the system provides "Conflict Options" (e.g., "Move Customer X to free up Stylist B"). The owner has final override power.

---

## 2. Staff Management (Stylist CRM)
### 2.1 Identity & Access
- **User Link**: Linked to `user_id` for auth.
- **Profile**: Professional details and availability.

### 2.2 The Skill Matrix (Eligibility)
Assignment depends on:
1. **Service Capability**: Mapping between Stylists and Services.
2. **Audience Compatibility**: Stylist's `serve_type` must match the service's `target_audience`.

### 2.3 Performance & Ops
- **Metrics**: Tracks revenue, retention (repeat customers), and quality (average ratings).
- **Tracking**: Daily check-in/out logs and active work time.

### 2.4 Attendance, leave, and active service time
- Staff clock-in/out records their salon presence. Recorded lunch intervals are
  subtracted from attendance hours; short personal breaks are not tracked or
  subtracted.
- Active service time is recorded separately with explicit start/end timestamps for
  each assigned staff member and service. Overlapping service intervals are merged
  for totals so concurrent work is not double-counted.
- Staff may request leave, review their requests and balance, and cancel pending
  requests. Salon staff managers configure leave types, add balance ledger grants or
  adjustments, review requests, and manage branch holidays.
- Only approved paid leave types configured to deduct balance debit the leave ledger.
  Emergency leave follows the selected leave type and may be unpaid.
- Attendance, leave, and service-time ledgers are separate from payroll and do not
  calculate salary, commission, or statutory payroll.

---

## 3. Change Log
- **v1.0**: Initial architecture.
- **v1.1**: Added Optional Inventory.
- **v1.2**: Implemented Asynchronous Concurrent Services and HITL logic.
