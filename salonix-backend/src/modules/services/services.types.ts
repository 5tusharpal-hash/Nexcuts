export type ServiceTargetAudience = 'MEN' | 'WOMEN' | 'KIDS' | 'UNISEX';
export type ServiceSortField = 'name' | 'price' | 'duration' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export interface CreateSalonServiceRequest {
  categoryId?: string;
  name: string;
  description?: string;
  estimatedDurationMinutes: number;
  basePrice: string;
  targetAudience: ServiceTargetAudience;
  isPublic: boolean;
  isActive: boolean;
  defaultImageId?: string;
}

export interface UpdateSalonServiceRequest {
  categoryId?: string | null;
  name?: string;
  description?: string | null;
  estimatedDurationMinutes?: number;
  basePrice?: string;
  targetAudience?: ServiceTargetAudience;
  isPublic?: boolean;
  isActive?: boolean;
}

export interface SalonServiceResponse {
  id: string;
  salonId: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  estimatedDurationMinutes: number;
  basePrice: string;
  targetAudience: ServiceTargetAudience;
  imageUrl: string | null;
  defaultImageId: string | null;
  isPublic: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListServicesQuery {
  limit: number;
  offset: number;
  search?: string;
  categoryId?: string;
  targetAudience?: ServiceTargetAudience;
  sortBy: ServiceSortField;
  sortDirection: SortDirection;
  includeInactive: boolean;
}

export interface CreateServiceCategoryRequest {
  name: string;
  description?: string;
  defaultImageCategoryKey?: string;
  displayOrder: number;
}

export interface UpdateServiceCategoryRequest {
  name?: string;
  description?: string | null;
  defaultImageCategoryKey?: string | null;
  displayOrder?: number;
}

export interface ServiceCategoryResponse {
  id: string;
  salonId: string;
  name: string;
  description: string | null;
  defaultImageCategoryKey: string | null;
  displayOrder: number;
  isActive: boolean;
  serviceCount: number;
}

export interface ServiceDefaultImageResponse {
  id: string;
  categoryKey: string;
  altText: string | null;
  imageUrl: string;
}

export interface GalleryCategoryResponse {
  id: string;
  salonId: string;
  categoryName: string;
  displayOrder: number;
  isActive: boolean;
  imageCount: number;
}

export interface GalleryImageResponse {
  id: string;
  salonId: string;
  categoryId: string;
  imageUrl: string;
  altText: string | null;
  isFeatured: boolean;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
}

export interface GalleryQuotaResponse {
  enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
  source: 'PLAN' | 'ADDON' | 'ADMIN_OVERRIDE' | 'DISABLED';
}

export interface SetGalleryQuotaOverrideRequest {
  limit: number;
  reason: string;
  expiresAt?: Date;
}

export interface ServiceImageSettingsResponse {
  serviceImageRequired: boolean;
}
