# Billing: Refunds & Credit Notes Logic

## 1. Overview
The Salonix system implements a professional financial model for handling reversals. Instead of simply deleting a bill, the system uses **Credit Notes** to maintain a perfect audit trail for taxes (GST) and accounting.

---

## 2. The Refund Flow

### 2.1 Full Refund
- **Trigger**: Customer requests a full refund for a paid service.
- **Action**: 
    1. Create a `Credit Note` for the full amount.
    2. Change `bills.payment_status` to `REFUNDED`.
    3. Trigger a payout to the customer's original payment method.

### 2.2 Partial Refund / Credit Note
- **Trigger**: A service was partially unsatisfactory, or a branch was paused (per B2B blueprint).
- **Action**: 
    1. Generate a `Credit Note` for the specific amount.
    2. The amount is added to the `user_credits` balance.
    3. This credit can be applied to any future `POS Billing` transaction.

---

## 3. Database Schema Logic

### `credit_notes` Table
- `id` (PK)
- `bill_id` (FK) $\rightarrow$ The original bill being refunded.
- `userId` (FK)
- `amount` (Decimal) $\rightarrow$ The refund value.
- `reason` (Enum: `SERVICE_ISSUE`, `BRANCH_PAUSE`, `CUSTOMER_REQUEST`, `ERROR`)
- `status` (Enum: `ISSUED`, `REDEEMED`, `EXPIRED`)
- `expiry_date` (Timestamp) $\rightarrow$ Credits usually expire after 6-12 months.

### `user_credits` Table
- `userId` (PK/FK)
- `balance` (Decimal) $\rightarrow$ Current usable credit for the customer.

---

## 4. The Redemption Bridge
When `POSBillingService.generateBill()` is called:
1. System checks `user_credits` balance.
2. Prompt: "You have ₹500 in credits. Apply to this bill?"
3. If Yes $\rightarrow$ Deduct from `user_credits` $\rightarrow$ Update `bill.discount_amount`.
