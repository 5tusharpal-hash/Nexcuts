# POS Billing Workflow

## Scope

POS is the salon's backend workflow for preparing invoices, recording salon-approved
payments, and keeping an auditable bill and payment history. It does not collect or
settle money on behalf of a salon. The frontend is outside this backend workflow.

Every bill belongs to one salon, one customer, and one POS session. Sessions can
originate from a queue, a walk-in, or an offline sale. Group billing is not part of
this workflow; each customer receives a separate invoice.

## Bill lifecycle

1. Open a session for the customer. Queue sessions may link a queue entry or booking.
   Walk-in and offline-sale sessions cannot link either.
2. Create a draft bill with service, inventory product, or one package/combo sale.
   Service and product prices are read from the current salon catalog. Offer sale
   prices come from the offer purchase request's approved quote.
3. Edit the bill while it is draft or issued. Each issued invoice version is kept as
   a snapshot; editing does not rewrite a version already sent to the customer.
4. Issue an invoice version for customer review. Changes after issue make older
   versions stale, so the customer and salon can identify the version being confirmed.
5. Confirm the current invoice version at the salon. Confirmation applies inventory
   deductions and freezes the billable amount.
6. Record one or more tenders, or approve customer-submitted payment claims.
   Successful tenders update the balance; claims do not change it until approved.
7. When a package/combo sale is fully paid, the offer settlement flow activates its
   entitlement and writes the sale to the offer ledger.

## Staff tips

Tips are not part of invoice subtotal, discount, tax, or payment balance. A customer
may request a tip for a staff member assigned to a service on their confirmed bill.
The desk may submit the same kind of request during manual billing. An authorized
staff manager approves or rejects each request. Approval records the tip separately
in the POS tip record and the staff tip ledger; it records the salon's acknowledgement
of receipt, not a payout or distribution. Staff can read their own tip balance and
entries, while managers can inspect a staff member's ledger.

The salon records each tender separately, allowing split payments such as cash plus
UPI. Payment modes include cash, UPI, card, and other. Idempotency keys prevent a
retry from recording the same payment twice.

## Bill items, discounts, tax, and inventory

- Service and product lines can be added, removed, or repriced before confirmation.
- Manual discounts apply to service and product lines. Package/combo sale discounts
  must be applied to the offer quote, not as an unrelated POS line discount.
- Tax defaults are configurable per salon and category. A reason is required for a
  per-line tax override. Category payment rules can be set by the salon and
  overridden on an unconfirmed bill.
- Retail product stock is deducted from the explicitly selected batch when the salon
  confirms the invoice, not when the draft is created. Batch quantities must match
  the product line quantity; the system never auto-selects a batch. Expired batches
  require an authorized salon-side override with a recorded reason.
- Service consumables are salon-use inventory and are not deducted by POS. If a
  service has an estimated consumable mapping, confirmation records a theoretical
  usage estimate for reporting only. Services without mappings work normally.
- Offline product sales use the same catalog pricing, stock checks, invoice versions,
  and confirmation rules as queue and walk-in sales.

## Package and combo sales

Package and combo sales use the salon-offerings purchase request and quote workflow.
The offer is attached to a separate POS bill line. A bill may contain at most one
package or combo sale; create another bill for an additional offer.

The POS bill must match the approved offer quote. The entitlement and offer-sale
ledger entry are created only after the bill is fully settled. Package entitlements
retain their purchased service snapshot and use current service prices when credit
is redeemed. Combos are one-time entitlements with their purchased terms preserved.

## Wallet use and customer payment claims

Customers can submit a payment claim against an issued bill version. Salon approval
is required before a claimed payment changes the bill balance. Customers can also
submit advance payments, which the salon approves before those amounts are available
for bill allocation.

Package, combo, and loyalty allocations are handled as wallet-redemption requests.
The customer verifies the request with an OTP, and the salon must approve it before
the entitlement or loyalty balance changes. An OTP is bound to its redemption
request. Failed OTP delivery releases the pending redemption.

## Refunds and customer invoices

Only the salon owner can issue or review a POS refund. A refund request must be
created within the invoice's seven-day window and cannot exceed successful payments
that have not already been reserved for another refund. Completing a request issues
a salon credit note and in-app notice to the customer. Cancelling a request does not
issue credit.

An offer entitlement attached to the refunded invoice is reversed only when the
package or combo is entirely unused. A partially or fully used entitlement cannot
be reversed. The refund, credit note, offer reversal, and audit event are committed
in one transaction.

Customers can list and read only their own issued or confirmed invoices for a salon.
Draft invoices are not exposed through customer invoice endpoints.

## Audit and notifications

Bill versions, payment claims, payments, wallet requests, refund events, and category
rule changes are retained in the POS ledger/audit records. Invoice issue, wallet
redemption completion, and completed refunds create in-app notifications. Push,
email, WhatsApp, and SMS invoice delivery still require their provider integrations
and are not sent by this workflow. Notification metadata records the intended
fallback order: email, WhatsApp, then SMS after in-app and push. A future WhatsApp
dispatcher must require an active plan feature or WhatsApp add-on. Salonix credit-line
checks are intentionally not part of the current direct-to-Meta billing flow.
