import { logger } from '../../bootstrap/logger.js';
import { realtimeService } from '../realtime/realtime.service.js';

export enum QueueEvent {
    QUEUE_UPDATED = 'QUEUE_UPDATED',
    TIME_SHIFTED = 'TIME_SHIFTED',
    STATUS_CHANGED = 'STATUS_CHANGED',
    STYLIST_UPDATE = 'STYLIST_UPDATE',
    NOTIF_RECEIVED = 'NOTIF_RECEIVED'
}

export interface SocketPayload {
    eventId: QueueEvent;
    branchId: string;
    data: any;
    userId?: string; // If it's a private notification
}

export class SocketService {

    /**
     * Broadcast to everyone in a specific salon branch
     */
    async broadcastToBranch(branchId: string, event: QueueEvent, _data: any) {
        logger.debug({ event, branchId }, 'Broadcasting salon socket event');
        await realtimeService.publish({
            type: event,
            salonId: branchId,
            payload: _data,
            occurredAt: new Date().toISOString(),
        });
    }

    /**
     * Send a private real-time update to a specific user
     */
    async sendToUser(userId: string, event: QueueEvent, _data: any) {
        logger.debug({ event, userId }, 'Sending private socket event');
        await realtimeService.publish({
            type: event,
            userId,
            payload: _data,
            occurredAt: new Date().toISOString(),
        });
    }

    /**
     * Update a specific stylist's live status
     */
    async updateStylistStatus(branchId: string, stylistId: string, status: string) {
        this.broadcastToBranch(branchId, QueueEvent.STYLIST_UPDATE, { stylistId, status });
    }
}
