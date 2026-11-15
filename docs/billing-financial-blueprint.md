# Financial & Billing Blueprint: Consolidated Billing, Distributed Invoicing

## 1. Executive Summary
The Salonix Billing System follows a **"Consolidated Bill, Distributed Invoice"** model. The objective is to provide a seamless payment experience for the Account Owner (one total amount) while maintaining strict legal and tax compliance for individual branches (multiple invoices with different GST/Tax rules).

---

## 2. The "Grocery Store" Model (Payment vs. Invoicing)

### 2.1 Conceptual Flow
- **The Bill (The "Payment")**: A single aggregate charge applied to the Account's primary payment method.
- **The Invoices (The "Receipts")**: Multiple legal documents generated based on the branch's location and services consumed.

**Scenario**:
- Account Owner has Branch A (Delhi) and Branch B (Mumbai).
- **Total Bill**: ₹10,000 (Consolidated).
- **Invoice 1**: Branch A - ₹5,000 + Delhi GST (Legal document for Delhi).
- **Invoice 2**: Branch B - ₹5,000 + Mumbai GST (Legal document for Mumbai).

### 2.2 Multi-State Tax (GST) Logic
- Each branch is linked to a `State` and a `GST_Number`.
- The billing engine calculates tax per branch based on the branch's local laws.
- The consolidated bill is the sum of all branch-level tax-inclusive costs.

---

## 3. Resource Lifecycle & Proration Logic

### 3.1 The "Single Billing Date" Sync
Regardless of when a branch is added, the account has one **Anchor Date** (e.g., the 1st of the month).

### 3.2 Granular Branch Management
- **Adding a Branch (Proration)**:
  - Formula: `(MonthlyRate / DaysInMonth) * RemainingDaysInCycle`.
  - The user pays only for the days left until the Anchor Date.
- **Pausing/Cancelling a Branch**:
  - If a branch is paused on the 15th, the remaining 15 days are calculated as a **Credit Note**.
  - This credit is applied to the next Consolidated Bill.

### 3.3 Payment Terms & Access
- **Standard Rule**: "Pay First, Use Later." Services are locked until the invoice is settled.
- **Admin Grace Period**: 
  - An override that allows service usage before payment.
  - **Penalty/Sync Logic**: If a user utilizes the Grace Period, the system bills them for the **full remaining month** immediately to reset and sync the billing date.

---

## 4. Enterprise Subscription Features

### 4.1 Autopay (Recurring Billing)
- **Tokenized Payments**: Securely stored payment tokens (Netflix-style).
- **Automated Cycle**: Triggered on the Anchor Date.
- **Failure Flow**: `Payment Fail` $\rightarrow$ `Grace Period Start` $\rightarrow$ `Admin Alert` $\rightarrow$ `Service Lock`.

### 4.2 Account-Level Trial & Promotional Logic
- **Global Trial Flag**: A trial is granted to the **Account**, not the branch.
- **Scenario A (Trial Active)**: New branches join the remaining trial days of the account.
- **Scenario B (Trial Off/Promotional)**: New branches are billed normally from day one.
- **Billable Add-ons**: High-value add-ons are billed immediately, even if the base subscription is in the Trial period.

---

## 5. Decision Matrix for Future Implementation

| Action | Impact | Requirement |
|---|---|---|
| **Add Branch** | Prorated Charge | Check Account Anchor Date $\rightarrow$ Calculate Days $\rightarrow$ Bill. |
| **Pause Branch** | Credit Generation | Calculate unused days $\rightarrow$ Create Credit Note $\rightarrow$ Apply to Next Bill. |
| **Upgrade Plan** | Immediate Proration | `(NewRate - OldRate)` for remaining days $\rightarrow$ Bill immediately. |
| **Service Add-on** | Immediate Charge | Bypass Trial $\rightarrow$ Bill as separate line item $\rightarrow$ Generate Invoice. |

---

## 6. Change Log & Versioning
- **v1.0 (Initial Blueprint)**: Defined Consolidated Billing, Floating GST, Proration, and Account-level Trial logic.
