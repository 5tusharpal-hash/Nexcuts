# Salon Inventory System

## Scope and separation

Inventory has two independent stock pools. A real-world item used both for salon
services and retail sales is entered as two product records. Stock, batches, low-stock
settings, movements, and reports are never shared between those records.

- **Retail stock** is counted in whole units or packs and is deducted at POS invoice
  confirmation.
- **Salon-use stock** is counted in whole bottles or packs and is issued to a named
  stylist or the shared floor. It is not sold at POS.
- Service-consumable mappings and estimates are a separate reporting ledger. They
  do not change physical stock, block services, or claim exact measured usage.
- Barcode lookup and reminders are supporting features. They can be omitted or
  disabled without disabling catalog, receiving, corrections, or either stock pool.

## Products and receiving

Create a product catalog record once and add its common product barcode(s). Receiving
stock creates one batch for each distinct lot/expiry combination. For example, twelve
bottles from two lots with different expiry dates are recorded as two batches, six
units in each. The common barcode identifies the product, not its batch.

Batch number and expiry are optional because supplier packaging may omit them. A
missing expiry is reported as unknown, not treated as safe or expired. Receiving
does not require a label printer. An operator selects the actual batch whenever stock
is moved; the system never chooses a batch by FIFO or FEFO. If a common barcode is
registered on both the retail and salon-use record, lookup returns both records so
the salon workflow can choose the correct independent stock pool.

Existing products are classified using their legacy sellable/internal-only flags only
when those flags identify exactly one flow and stock is already counted in whole units
or packs. Ambiguous or measured-unit products remain `LEGACY_UNCLASSIFIED` until an
authorized operator reconciles them. Existing totals without batch rows receive a
no-expiry opening batch. Before migration, existing batch totals must not exceed the
product total; the migration stops for manual reconciliation if they do. Opening
batches are recorded as opening-balance ledger movements. It does not automatically
split an ambiguous product into retail and salon-use stock.

## Retail sales and batch selection

The POS line records one or more explicit batch allocations, and their quantities must
sum to the whole-unit line quantity. Confirmation decrements only those batches and
the matching product total in the same database transaction as the invoice. Missing
or insufficient selected-batch stock rejects confirmation.

The batch's expiry state is visible to authorized salon staff:

- `OK`: more than 30 days until expiry, or no expiry date.
- `NEAR_EXPIRY`: expiry is within 30 days.
- `EXPIRED`: expiry date is before today.
- `UNKNOWN`: no expiry date was recorded.

An expired batch requires an inventory manager's permission and an override reason.
The override is retained on the stock ledger. These warnings are salon-side; they are
not sent to customers.

## Salon-use issue flow

A staff member requests whole bottles or packs for themselves or the shared floor.
An inventory manager selects the actual batch and records the handover. A request
does not reserve or deduct stock until it is approved and issued. Issuance decrements
the selected batch and records requester, recipient, issuer, quantity, and time.

When an issued bottle or pack is returned, marked empty, damaged, lost, or wasted, a
separate close event records the actor, status, note, and time. Returns restore stock
to the original batch. Damage, loss, waste, and empty status do not deduct the bottle
again because the whole unit left available stock at handover.

## Service estimates

An authorized inventory manager may map a salon-use product to a service with an
estimated quantity and unit. When a POS service line is confirmed, Salonix records
the estimate against that bill line. It is a theoretical usage/reporting value only.
For example, a 50 ml estimate across nine services records 450 ml estimated usage,
but does not claim that a 500 ml bottle has exactly 50 ml left. Pump waste, spills,
and actual staff usage are represented through whole-bottle issue, return, empty, or
audited correction events instead.

Services without a mapping continue normally. Estimated use never decrements stock or
blocks checkout.

## Corrections and audit

Stock is not edited by overwriting product totals. Corrections target an explicit
batch and append an immutable ledger movement with actor, reason, note, and time.
Supported reasons include damage, loss, waste, expiry, stock-count correction,
found stock, and return. Negative changes cannot exceed batch or product balance.
Products with history are archived rather than physically deleted.

## Alerts and scheduled job

Low-stock alerts are opt-in per product. When enabled, the daily job sends one in-app
notification to the salon owner and active inventory managers when stock first
reaches the configured threshold. It sends a new alert only after stock recovers and
then becomes low again.

The daily job also sends salon-side in-app notifications 30 and 7 days before a
non-empty batch expires. A batch can produce one notification per lead time and
recipient. The inventory APIs expose current low-stock and expiring/expired batches
even when no scheduled job is configured.

Run the job from the backend package with `pnpm inventory:reminders`. Configure the
deployment scheduler to invoke it once daily. The job uses a PostgreSQL advisory lock
and unique delivery records to avoid duplicate concurrent runs and repeated expiry
notifications.

## API surface

All routes are under `/api/v1/salons/{salonId}`. Catalog, receiving, corrections,
batch selection, mappings, alerts, and ledgers require `inventory:manage`. Staff may
create and view their own issue requests; inventory managers review and issue them.
Lists use `limit` and `offset`.
