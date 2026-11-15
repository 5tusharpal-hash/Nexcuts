export interface SalonEnquiry {
    id: string;
    branchId: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string | null;
    serviceInterest?: string;
    message: string | null;
    status: 'NEW' | 'CONTACTED' | 'NEGOTIATING' | 'CONVERTED' | 'CLOSED';
    createdAt: Date;
    updatedAt: Date;
}

export interface EnquiryResponse {
    id: string;
    enquiryId: string;
    staffId: string;
    note: string;
    isExternalReply: boolean;
    createdAt: Date;
}

export interface CreateEnquiryRequest {
    branchId: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    serviceInterest?: string;
    message: string;
}

export interface UpdateEnquiryStatusRequest {
    status: Exclude<SalonEnquiry['status'], 'NEW' | 'CONVERTED'>;
}

export interface EnquiryListQuery {
    status?: Exclude<SalonEnquiry['status'], 'CONVERTED'>;
    limit: number;
    offset: number;
}

export interface EnquiryListResponse {
    items: SalonEnquiry[];
    total: number;
}

export interface EnquiryResponseList {
    items: EnquiryResponse[];
    total: number;
}
