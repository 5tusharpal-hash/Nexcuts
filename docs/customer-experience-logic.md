# Customer Experience Logic

## 1. Overview
The Customer Side is the B2C interface. It allows users to discover salons, manage their reservations, track their paid subscriptions, and earn rewards. It is a consumption layer that reads data from the Salon side and manages user-specific data.

## 2. Module Breakdown

### 2.1 Discovery (Consumption Layer)
This is a read-only view for the customer. It queries the Salon-side data:
- **Search & Discovery**: Find salons based on location, name, or specific services.
- **Public Salon Pages**: View the salon's public profile, gallery, and services.
- **Live Pulse**: Real-time data on current queue length, estimated wait time, and next available slot.
- **Enquiry**: Submit a request to the salon (triggers the Enquiry module).

### 2.2 `cust_bookings` (Reservation Engine)
- **Preferred Time**: Reservations for future dates (e.g., next 2-7 days).
- **Auto-Queue Transition**: On the day of the appointment, the reservation automatically converts into an active `queue_entry`.
- **Coordinator Model**: Support for group bookings where one user manages the reservation for multiple people.

### 2.3 `cust_subscriptions` (Paid Plans & Combos)
- **Paid Access**: Tracks purchased Packages and Combos per salon.
- **Usage Tracking**: Deducts counts or value as services are consumed.
- **Unified View**: Users can see a list of all plans they own across different salons.

### 2.4 `cust_rewards` (Loyalty Points)
- **Bonus System**: Tracks points earned based on spending.
- **Salon-Specific**: Points are tracked per salon.
- **FIFO Expiry**: Points expire based on a per-batch timeline.

### 2.5 `cust_account` (Identity & Governance)
- **Visit History**: A complete ledger of all services taken, bills paid, and stylists visited.
- **Governance**: Notification settings and a mandatory **Account Deletion** flow (GDPR compliance).
- **Support**: Ticket-based support system for platform-level issues.

---

## 3. Change Log
- **v1.0**: Initial architecture.
- **v1.1**: Refactored Discovery to be a consumption layer of Salon-side data. Separated Paid Subscriptions from Loyalty Rewards.
