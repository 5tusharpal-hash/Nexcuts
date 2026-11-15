export interface MarketingCampaign {
    id: string;
    branchId: string;
    name: string;
    templateId: string;
    targetCriteria: Record<string, any>;
    scheduledAt?: Date;
    status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'COMPLETED' | 'CANCELLED';
}

export interface DeliveryLog {
    id: string;
    campaignId: string;
    userId: string;
    channel: 'IN_APP' | 'WHATSAPP' | 'SMS' | 'EMAIL' | 'PUSH';
    status: 'PENDING' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'READ';
    sentAt: Date | null;
    attemptCount: number;
    lastAttemptAt: Date | null;
    lastError: string | null;
}

export interface CampaignTarget {
    minSpend?: number;
    lastVisitDays?: number;
    serviceIds?: string[];
}
