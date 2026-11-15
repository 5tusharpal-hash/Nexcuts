import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReviewSchema, publicReviewQuerySchema } from './reviews.validation.js';

const validReview = {
  billId: '00000000-0000-4000-8000-000000000001',
  salonRating: 5,
  stylistRatings: [{
    stylistId: '00000000-0000-4000-8000-000000000002',
    rating: 4,
  }],
};

test('review request validates bounded salon and stylist ratings', () => {
  assert.equal(createReviewSchema.safeParse(validReview).success, true);
  assert.equal(createReviewSchema.safeParse({ ...validReview, salonRating: 6 }).success, false);
  assert.equal(
    createReviewSchema.safeParse({
      ...validReview,
      stylistRatings: [{ ...validReview.stylistRatings[0], rating: 3.5 }],
    }).success,
    false
  );
});

test('public review pagination is bounded and defaults safely', () => {
  assert.deepEqual(publicReviewQuerySchema.parse({}), { limit: 20, offset: 0 });
  assert.equal(publicReviewQuerySchema.safeParse({ limit: 101 }).success, false);
});
