# Enquiry & Lead Management Logic

## 1. Overview
The Enquiry module handles the "top of the funnel" for the salon. It manages potential customers who have a query but haven't committed to a booking yet. This transforms the system from a simple booking tool into a Lead Management System (LMS).

## 2. The Lead Lifecycle
An enquiry follows a specific state machine to ensure no lead is forgotten:
- **NEW**: The enquiry has just arrived. Trigger an instant alert to the salon owner.
- **CONTACTED**: The salon has reached out to the customer.
- **NEGOTIATING**: Discussing prices, special requirements, or timing.
- **CONVERTED**: The lead has successfully booked a service (automatic transition to `queue_entries`).
- **CLOSED**: The lead is no longer interested or unreachable.

## 3. Operational Flow
### 3.1 Customer Touchpoint
On the public salon page, customers can submit:
- Contact Details (Name, Phone, Email).
- Area of Interest (Specific service or category).
- Custom Message.

### 3.2 Owner's Workflow
- **Real-time Alerts**: Owner receives a high-priority notification via the `NotificationDispatcher`.
- **One-Click Conversion**: The owner can click "Convert to Booking," which pulls the enquiry data into the `QueueService` to create an appointment without re-entering details.

### 3.3 Communication Audit
Every reply or note added by the salon staff is logged in the `enquiry_responses` table to maintain a history of the conversation.

---

## 4. Change Log
- **v1.0**: Initial architecture for the Enquiry system. Defined lead states and the "Convert to Booking" pipeline.
