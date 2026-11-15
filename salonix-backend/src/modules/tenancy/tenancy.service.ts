import { TenancyRepository } from './tenancy.repository.js';
import type {
  CreateOrganizationRequest,
  ReviewSalonApplicationRequest,
} from './tenancy.types.js';

export class TenancyService {
  constructor(private readonly repository: TenancyRepository) {}

  createOrganizationForOwner(accountId: string, data: CreateOrganizationRequest) {
    return this.repository.createOrganizationForOwner(accountId, data);
  }

  getMySalons(accountId: string) {
    return this.repository.findSalonsForAccount(accountId);
  }

  getMyApplications(accountId: string) {
    return this.repository.findApplicationsForOwner(accountId);
  }

  updateApplication(
    accountId: string,
    salonId: string,
    data: CreateOrganizationRequest
  ) {
    return this.repository.updateApplication(accountId, salonId, data);
  }

  getApplicationsForReview(query: {
    limit: number;
    offset: number;
    status?: string;
  }) {
    return this.repository.findApplicationsForReview(query);
  }

  reviewApplication(
    adminAccountId: string,
    salonId: string,
    review: ReviewSalonApplicationRequest
  ) {
    return this.repository.reviewApplication(adminAccountId, salonId, review);
  }
}
