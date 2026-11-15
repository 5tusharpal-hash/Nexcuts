import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { ReviewService } from './reviews.service.js';
import {
  createReviewSchema,
  publicReviewQuerySchema,
  reviewSalonIdSchema,
} from './reviews.validation.js';

export class ReviewsController {
  constructor(private readonly service: ReviewService) {}

  async create(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user || request.user.account_type !== 'CUSTOMER') {
      throw new ApiError(403, 'A customer account is required to submit a review');
    }
    const salonId = reviewSalonIdSchema.parse(requireRouteParam(request.params, 'salonId'));
    const input = createReviewSchema.parse(request.body);
    const result = await this.service.createReview(salonId, request.user.id, input);
    return reply.status(201).send({ success: true, data: result });
  }

  async listPublic(request: FastifyRequest) {
    const salonId = reviewSalonIdSchema.parse(requireRouteParam(request.params, 'salonId'));
    const query = publicReviewQuerySchema.parse(request.query);
    const result = await this.service.getSalonReviews(salonId, query.limit, query.offset);
    return {
      success: true,
      data: result.items,
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total: result.total,
      },
    };
  }
}
