# Employee Management

## Scope and separation

Employee management is a salon-local backend module, separate from onboarding,
inventory, POS settlement, payroll, and frontend work. It records attendance,
service activity, leave, holidays, and approved staff-tip credits. It does not
calculate payroll, salary, commissions, or tip payouts.

## Attendance and active service

Staff clock in and out through authenticated endpoints. An employee may have only
one open shift at a time. Lunch is recorded as an interval and is subtracted from
attendance time. Short personal breaks are not tracked or subtracted. Clock-out is
blocked while lunch or service work is still open.

Service work has separate explicit start/end records for each assigned staff member.
The source can be an assigned queue service or a service line on a non-cancelled POS
bill. Staff must be clocked in to start service work. Reports merge overlapping
service intervals so simultaneous services are not counted twice. Attendance time
and active service time remain separate metrics.

## Holidays and leave

Holiday dates are configured per salon branch. Leave types define whether leave is
paid, deducts an employee balance, or is an emergency type. Staff submit requests
with dates, requested days, and a reason; overlapping pending or approved requests
are rejected. Staff may cancel pending requests.
Requested leave days are entered explicitly; weekends and holidays are not
automatically excluded from the requested-day count.

Managers grant or adjust leave balances through an immutable ledger. Balance is the
sum of grants and adjustments less approved paid leave debits. Approval is rejected
if it would make a balance negative. Unpaid leave or a type configured not to deduct
balance does not debit the ledger. Emergency leave uses its selected leave type, so
it may be paid and balance-backed or unpaid.

## Tips

Tips stay outside invoice totals, tax, and payment allocations. Customers can submit
a request for a staff member assigned to a service on their confirmed bill. The desk
can submit the same request type for an in-person/manual workflow. Only a manager
with staff-management permission can approve or reject a pending request.

Approval records a separate POS tip and an immutable staff tip-ledger credit. This
means the salon acknowledged the tip receipt; it does not represent or execute a
cash payout or distribution. Staff can inspect their own tip balance and ledger.
Managers can inspect staff tip ledgers.
Refunding a POS bill does not automatically refund its separate tip.

Customers or the desk can request a full or partial refund against an approved tip.
Active requests reserve the requested amount so concurrent refunds cannot exceed
the original tip. A manager must approve the request before the salon refunds the
customer outside Salonix. After the payout is made, a manager records completion;
only then is an immutable reversal added to the staff tip ledger. Salonix records
the payout reference but does not initiate an external payment.

## API and access

All endpoints are under `/api/v1`. Staff use authenticated self-service attendance,
leave, and ledger endpoints. Managers with `staff:manage` configure holidays and
leave types, review leave and tip requests, grant balances, and record service
intervals. Desk tip requests require `billing:manage`. Customer tip and tip-refund
requests are restricted to their own bill/tip. Tip-refund approval and completion
require `staff:manage`; completion records an already-paid external refund.

Lists are paginated and accept date range filters. All state changes are committed
transactionally where balances or approvals are involved.
