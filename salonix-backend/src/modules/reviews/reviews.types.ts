export interface Review {
    id: string;
    billId: string;
    customerId: string;
    rating: number;
    comment?: string;
    isPublic: boolean;
    createdAt: Date;
}

export interface StylistReview {
    id: string;
    billId: string;
    customerId: string;
    stylistId: string;
    rating: number;
    comment?: string;
    createdAt: Date;
}

export interface ReviewSubmission {
    salonId: string;
    billId: string;
    customerId: string;
    salonRating: number;
    salonComment?: string;
    stylistRatings: Array<{
        stylistId: string;
        rating: number;
        comment?: string;
    }>;
}

export interface CreateReviewRequest {
    billId: string;
    salonRating: number;
    salonComment?: string;
    stylistRatings: Array<{
        stylistId: string;
        rating: number;
        comment?: string;
    }>;
}

export interface PublicReview {
    id: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
}
