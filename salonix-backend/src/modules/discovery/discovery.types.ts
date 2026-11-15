export interface SalonPublicProfile {
    salonId: string;
    slug: string;
    publicDescription?: string;
    contactPhone?: string;
    contactEmail?: string;
    addressText?: string;
    latitude?: number;
    longitude?: number;
    isVerified: boolean;
}

export interface GalleryCategory {
    id: string;
    salonId: string;
    categoryName: string;
    displayOrder: number;
}

export interface GalleryImage {
    id: string;
    categoryId: string;
    salonId: string;
    imageUrl: string;
    altText?: string;
    isFeatured: boolean;
}

export interface SalonDiscoveryData {
    profile: SalonPublicProfile;
    gallery: Array<{
        category: GalleryCategory;
        images: GalleryImage[];
    }>;
}

export interface PublicGalleryPage {
    items: Array<{
        category: GalleryCategory;
        images: GalleryImage[];
    }>;
    total: number;
}

export interface DiscoveryQuery {
    limit: number;
    offset: number;
}

export interface SalonSearchQuery extends DiscoveryQuery {
    query?: string;
    city?: string;
    service?: string;
}

export interface PublicSalonSearchResult {
    salonId: string;
    name: string;
    slug: string;
    city?: string;
    addressText?: string;
    publicDescription?: string;
    isVerified: boolean;
}
