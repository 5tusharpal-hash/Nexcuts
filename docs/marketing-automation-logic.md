# Marketing & Automation Engine Logic

## 1. Overview
The Marketing & Automation module is a premium, paid extension of the Notification System. While the Notification system handles *utility* (transactional) alerts, this module handles *revenue-generating* communications (campaigns, drip sequences, and bulk outreach).

## 2. Tiered Communication Model
To monetize the platform, notifications are split into two tiers:

### 2.1 Utility Tier (Standard/Free)
- **Purpose**: Operational alerts (e.g., "Appointment confirmed", "Queue shifted").
- **Channels**: In-App and Push Notifications.
- **Cost**: Included in the base subscription.

### 2.2 Marketing Tier (Premium/Paid)
- **Purpose**: Growth and Retention (e.g., "Come back for a discount", "Birthday Wishes", "Bulk Promo").
- **Channels**: WhatsApp Business API, SMS, Email.
- **Cost**: Monthly add-on fee or per-message credit.
- **Verification**: The system checks `platform_branch_add_ons` or account status before dispatching any premium channel message.

---

## 3. Automation Features

### 3.1 Campaign Manager
Allows salon owners to create targeted outreach:
- **Segmentation**: Target customers based on criteria (e.g., "Spent > ₹5000", "Last visit > 60 days").
- **Bulk Dispatch**: Send a single template to thousands of customers.

### 3.2 Drip Sequences (Automated Journeys)
Pre-defined sets of messages sent over time:
- **Welcome Sequence**: Day 1 (Welcome) $\rightarrow$ Day 3 (Review Request).
- **Retention Sequence**: Day 30 (Miss you) $\rightarrow$ Day 45 (Special Offer).

### 3.3 Integration Wrapper
A decoupled integration layer ensures that if the platform switches from one WhatsApp provider to another, the core business logic remains unchanged.

---

## 4. Change Log
- **v1.0**: Initial blueprint for Paid Marketing modules. Defined the distinction between Utility and Premium tiers.
