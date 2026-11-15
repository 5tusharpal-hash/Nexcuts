# Loyalty, Packages, and Combos Logic

## 1. Packages

A package has a customer selling price, usable credit, validity period, and a fixed service set. Each included service may have an optional maximum-use count. An unset count means the service is eligible until package credit or validity is exhausted.

- Selling price and usable credit are separate values. Example: customer pays ₹500 and gets ₹600 usable package credit.
- Every service redemption deducts that service's current salon price from the remaining credit.
- A service use also consumes its optional per-service count.
- Redemptions are limited to services in the purchased package snapshot.
- Catalog edits create a new immutable revision. Existing requests and purchases keep their captured service set, credit, duration, and terms. New requests use the latest listed revision.
- Package statuses are `DRAFT`, `UNLISTED`, `LISTED`, and `ARCHIVED`. Archiving does not delete offer or purchase history.

## 2. Combos

A combo has a fixed selling price, validity period, and fixed service set.

- All services in the purchased combo must be redeemed together in one visit.
- A combo purchase can be redeemed once only.
- The customer's paid combo price is fixed. Later changes to individual service prices do not change the combo or the purchase.
- Catalog edits create new revisions; existing purchases keep their original service set and terms.
- Combo statuses are `DRAFT`, `UNLISTED`, `LISTED`, and `ARCHIVED`.

## 3. Request, POS, and activation lifecycle

1. A customer requests a listed package or combo. A request does not grant usage.
2. The salon may reject the request with a reason or start billing.
3. POS opens a draft bill from the request's captured terms. The owner may apply a discount and record its reason before collecting payment.
4. A salon-created manual sale uses the same process. It identifies an existing customer by verified phone and records the selected final amount. Complimentary sales use a zero-amount bill with a reason.
5. POS links the draft bill to the request. POS owns payment collection, split modes, loyalty, taxes, final invoice creation, and bill settlement.
6. The offer module activates the purchase only after POS reports that the linked bill is closed and fully paid. Settlement is idempotent and records the invoice reference, approved quote, purchase snapshot, and ledger entry together.

Salonix does not collect or settle salon payments. A cash, UPI, split, or complimentary transaction is recorded by the salon's POS workflow.

## 4. Ownership and usage ledger

- Customers may own multiple packages and combos from each salon.
- Purchase records retain the offer revision, price, discount, reason, terms, services, bill reference, activation, and expiry.
- Package redemption records the service, current service price, credit deduction, remaining credit, and count usage.
- Combo redemption records the full service set and visit bill. Partial combo redemption is rejected.
- Salon and customer views are scoped to that customer and salon. Ledger entries are append-only; corrections must use an auditable reversal rather than deleting history.

## 5. Activation notifications

Successful activation always creates in-app and push notification records. External delivery is a separate notification concern and follows the configured order: eligible WhatsApp when the salon plan/add-on and message credits allow it, email if WhatsApp is unavailable or fails, then a short SMS fallback. Notification provider delivery, retry policy, and WhatsApp credit accounting must be handled by the notification delivery worker, not by package or POS transactions.

## 6. Loyalty Program

- Salon owners choose which POS categories earn points: services, products, packages, and combos.
- The minimum spend is calculated only from selected categories, using line totals after line discounts and before tax. Plan-covered service lines do not qualify.
- Points are previewed against the bill and issued only after the salon approves final bill settlement.
- The reward is calculated as `eligible spend × reward percentage × point conversion rate`. The conversion rate is measured in points per currency unit.
- Loyalty points always have limited expiry. The salon chooses an expiry duration from 1 to 3,650 days before the first points are issued. The default is 365 days. Expiry duration and conversion rate are locked after the first earning.
- Each earning is an independent point batch. Redemptions consume the earliest-expiring available batches first. The wallet shows the balance, redemption value, and upcoming expiry batches.
- Point redemption is requested through POS and requires customer OTP verification and salon approval. One point is valued as `1 / point conversion rate` currency units.
- Closing a program stops new earnings immediately. Existing points can be redeemed until the earlier of their individual batch expiry or one calendar year after closure. After that deadline, no points remain redeemable.
- Closing a program is final. Ledger history is append-only and records earnings, redemptions, expiry, and refund reversals.
- A refund reverses only unspent points earned on the refunded bill. Points already redeemed are not clawed back.
- There is no minimum-visit requirement. The qualifying threshold is based only on the salon's selected billing categories.

---

## 7. Change Log
- **v1.0**: Initial logic for Packages, Combos, and Loyalty.
- **v2.0**: Separated package selling price from usable credit, defined immutable offer revisions, POS settlement activation, manual sale quotes, combo all-at-once redemption, and append-only purchase/usage ledgers.
