# Notification & Communication Engine Logic

## 1. Overview
The Notification System is a high-performance, asynchronous dispatcher. It separates the "Trigger" (Business Logic) from the "Delivery" (External APIs) using an event-driven architecture to ensure the main application remains lightning-fast.

## 2. Asynchronous Event-Driven Architecture
To prevent API lag (e.g., waiting for a WhatsApp API response), the system uses a **Message Queue (Redis + BullMQ)**.

### 2.1 The Workflow
1. **Producer**: A module (Queue, Billing, etc.) pushes a `NotificationEvent` to the Redis Queue.
2. **Queue**: Events are categorized into priority lanes (CRITICAL, OPERATIONAL, MARKETING).
3. **Consumer (Worker)**: A background process picks up the event, fetches the template, and executes the delivery.

### 2.2 Priority Lanes
- **Critical (Lane 1)**: OTPs, Payment Failures. Processed instantly.
- **Operational (Lane 2)**: Appointment shifts, "Your turn" alerts. Processed in seconds.
- **Marketing (Lane 3)**: Bulk promos, Newsletters. Processed in batches.

## 3. Delivery Channels
- **In-App**: Stored in `account_notifications` for the bell icon.
- **Push**: Dispatched to registered FCM/APNs device tokens.
- **Email**: Available to all salons when the customer has an email address.
- **WhatsApp**: Available only when the salon plan/add-on and available message credits allow it.
- **SMS**: Reserved for the final fallback when earlier eligible channels are unavailable or fail.

## 4. Offer Activation Notifications
After a salon confirms a fully settled POS bill and the offer entitlement is activated:
1. Persist the in-app notification.
2. Queue the push notification.
3. Attempt WhatsApp only when the salon plan/add-on allows it and credits are available.
4. If WhatsApp is unavailable or fails, send email when the customer has an email address.
5. If email is unavailable or fails, send a concise SMS as the last fallback.

The event must include the offer name, invoice number, final amount, discount, and purchase reference. Delivery attempts must be asynchronous and idempotent so retries never activate an entitlement twice. The current salon-offerings API persists in-app and push notification rows with the fallback order and WhatsApp eligibility metadata; the delivery worker and external-channel fallback are not yet integrated.

## 5. Change Log
- **v1.0**: Initial architecture.
- **v2.0**: Transitioned to Asynchronous Event-Driven architecture with Redis/BullMQ for high-scale performance.
