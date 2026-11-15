import { ApiError } from '../../shared/errors/ApiError.js';
import type { CreateReviewRequest } from './reviews.types.js';
import { ReviewsRepository } from './reviews.repository.js';

export class ReviewService {
    constructor(private readonly repository: ReviewsRepository) {}

    async createReview(salonId: string, customerId: string, review: CreateReviewRequest) {
        if (review.salonRating < 1 || review.salonRating > 5) {
            throw new ApiError(400, 'Salon rating must be between 1 and 5');
        }
        await this.repository.submitReview({
            ...review,
            salonId,
            customerId,
        });
        return {
            publicReviewEligible: review.salonRating >= 4,
            message: review.salonRating >= 4
                ? 'Thank you for your feedback'
                : 'Thank you. Your feedback has been shared privately with the salon',
        };
    }

    getSalonReviews(salonId: string, limit: number, offset: number) {
        return this.repository.listPublicSalonReviews(salonId, limit, offset);
    }
}
