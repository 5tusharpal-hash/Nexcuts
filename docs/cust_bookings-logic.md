# Customer Bookings & Reservations Engine

## 1. Overview
The `booking` module manages the lifecycle of a customer's intent to visit a salon. It acts as a reservation layer that eventually feeds into the `queue` module.

## 2. Core Constraints (Strict Guardrails)
To prevent system abuse and ensure fair access, the following rules are enforced:

| Rule | Logic | Goal |
|---|---|---|
| **Daily Appointment Limit** | A user can only have **one** active appointment per calendar day. | Prevent slot hoarding. |
| **Anti-Hogging** | A user cannot book a new appointment if they are currently in an active queue anywhere on the platform. | Ensure fair queue flow. |
| **Lifecycle Lock** | Once a booking is made for a day, no further bookings for that same day are allowed until the existing one is `COMPLETED`, `CANCELLED`, or `NO_SHOW`. | Prevent duplicate bookings. |

## 3. Technical Workflow

### 3.1 The Reservation Flow
1. **Discovery**: Customer finds a salon $\rightarrow$ Requests a slot.
2. **Validation**: `BookingService` calls `QueueService.validateBookingEligibility`.
3. **Persistence**: Booking is created in `bookings` table with status `PENDING`.
4. **Confirmation**: Once salon confirms, status moves to `CONFIRMED`.

### 3.2 Transition to Queue (The "Bridge")
- **Trigger**: Scheduled job or real-time trigger when `preferred_time` is reached.
- **Action**: 
    - Create entry in `queue_entries` table.
    - Update `bookings.status` to `QUEUED`.
    - Link `bookings.queue_entry_id` to the new entry.

## 4. Database Schema (Conceptual)

### `bookings` Table
- `id` (UUID, PK)
- `user_id` (UUID, FK) - Indexed
- `salon_id` (UUID, FK) - Indexed
- `preferred_time` (Timestamp)
- `status` (Enum: `PENDING`, `CONFIRMED`, `QUEUED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`)
- `queue_entry_id` (UUID, FK, Nullable)
- `coordinator_id` (UUID, FK, Nullable) - For group bookings
- `created_at` / `updated_at` (Timestamp)
