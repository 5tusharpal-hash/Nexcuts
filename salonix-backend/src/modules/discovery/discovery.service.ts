import { ApiError } from '../../shared/errors/ApiError.js';
import { DiscoveryRepository } from './discovery.repository.js';
import { DiscoveryQuery, SalonSearchQuery } from './discovery.types.js';

export class DiscoveryService {
    constructor(private readonly repository: DiscoveryRepository) {}

    async getPublicProfile(slug: string) {
        const profile = await this.repository.getProfileBySlug(slug);
        if (!profile) throw new ApiError(404, 'Public salon profile not found');
        return profile;
    }

    async getPublicGallery(slug: string, query: DiscoveryQuery) {
        const profile = await this.getPublicProfile(slug);
        return {
            salonId: profile.salonId,
            ...(await this.repository.getGallery(profile.salonId, query.limit, query.offset)),
        };
    }

    async searchPublicSalons(query: SalonSearchQuery) {
        return this.repository.searchPublicSalons(query);
    }
}
