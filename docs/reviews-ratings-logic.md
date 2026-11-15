# Review & Rating System Logic

## 1. Overview
The Review & Rating system is designed to capture high-quality feedback from customers after every visit. It serves two purposes: improving the internal quality of stylists and enhancing the external reputation of the salon.

## 2. The Feedback Loop

### 2.1 Post-Visit Trigger
- **Trigger**: As soon as a `pos_bill` is marked as `CLOSED` and the `queue_entry` is marked as `COMPLETED`.
- **Customer Prompt**: An automated notification is sent to the customer asking for their feedback.

### 2.2 Two-Tier Rating System
To ensure granular data, the system splits ratings:
- **Salon Rating**: Overall experience (Ambiance, Cleanliness, Front-desk behavior).
- **Stylist Rating**: Specific ratings for every stylist who worked on the customer during that session.
- **Why?**: This allows the owner to identify if a bad experience was due to a specific person or a general salon issue.

### 2.3 The "Google Review" Funnel (Reputation Management)
To protect the salon's online image, the system uses a logic gate:
- **Score < 4 Stars**: The review is kept **Internal**. The owner is notified immediately to resolve the issue privately.
- **Score $\ge$ 4 Stars**: The customer is prompted with a "Thank You" message and a direct link to **Google Reviews** to share their positive experience publicly.

---

## 3. Analytics & Improvement
- **Stylist Growth Tracking**: The system tracks a stylist's average rating over time.
- **Low-Performer Alerts**: If a stylist's average rating drops below a threshold (e.g., 3.5 stars), an alert is sent to the manager.
- **Review-based Incentives**: Owners can reward stylists who consistently get 5-star reviews.

---

## 4. Change Log
- **v1.0**: Initial architecture for the Review & Rating system. Defined the Google Review funnel and Stylist-specific feedback.
