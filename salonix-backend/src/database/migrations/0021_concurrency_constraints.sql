-- Migration: 0021_concurrency_constraints.sql
-- Description: Implements "Anti-Hogging" rules: Single active queue entry and one appointment per day.

-- No new tables needed, but we ensure indices exist for fast global checks across all salons.
CREATE INDEX IF NOT EXISTS idx_queue_user_status ON queue_entries(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_user_date ON cust_reservations(customer_id, reservation_date);
