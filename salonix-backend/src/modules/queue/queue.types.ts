export interface QueueEntry {
    id: string;
    userId: string;
    salonId: string;
    serviceId: string;
    entryTime: Date;
    estimatedWaitTime: number; // in minutes
    status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
    priority: 'NORMAL' | 'VIP' | 'EMERGENCY';
    assignedStaffId?: string;
    position: number;
    manualOverrideReason?: string;
    scheduleVersion?: number;
    updatedAt?: Date;
}

export interface QueueJoinRequest {
    userId: string;
    salonId: string;
    serviceId: string;
    priority: QueueEntry['priority'];
    marketingConsent?: boolean;
    preferredStaffId?: string;
    preferredTime?: Date;
    serviceIds?: string[];
    replaceQueueEntryId?: string;
    replaceBookingId?: string;
}

export interface QueuePositionUpdate {
    userId: string;
    salonId: string;
    newPosition: number;
}

export interface QueueSummary {
    salonId: string;
    totalWaiting: number;
    averageWaitTime: number;
    nextInLine: string[]; // UserIds
}
