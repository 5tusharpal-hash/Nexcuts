import { z } from 'zod';

const ratingSchema = z.number().int().min(1).max(5);
const commentSchema = z.string().trim().max(3000).optional();

export const createReviewSchema = z.object({
  billId: z.string().uuid(),
  salonRating: ratingSchema,
  salonComment: commentSchema,
  stylistRatings: z.array(z.object({
    stylistId: z.string().uuid(),
    rating: ratingSchema,
    comment: commentSchema,
  })).max(20),
});

export const publicReviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reviewSalonIdSchema = z.string().uuid();
