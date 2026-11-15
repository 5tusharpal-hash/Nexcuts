import { logger } from '../../bootstrap/logger.js';
import { EmailIntegration } from '../../integrations/email/email.integration.js';
import { WhatsAppIntegration } from '../../integrations/whatsapp/whatsapp.integration.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { MarketingRepository } from './marketing.repository.js';
import type { MarketingCampaign } from './marketing.types.js';

type MarketingChannel = 'IN_APP' | 'EMAIL' | 'WHATSAPP';

export class MarketingService {
    constructor(
        private readonly repository: MarketingRepository,
        private readonly email: EmailIntegration,
        private readonly whatsapp: WhatsAppIntegration
    ) {}

    async createCampaign(
        salonId: string,
        name: string,
        titleTemplate: string,
        bodyTemplate: string,
        scheduledAt?: Date,
        channels?: MarketingChannel[]
    ): Promise<MarketingCampaign> {
        await this.requireMarketingSubscription(salonId);
        if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
            throw new ApiError(400, 'Scheduled time must be in the future');
        }
        return this.repository.createCampaign(
            salonId,
            name,
            titleTemplate,
            bodyTemplate,
            scheduledAt,
            channels
        );
    }

    async sendCampaign(
        salonId: string,
        campaignId: string,
        channel: MarketingChannel,
        limit: number
    ) {
        await this.requireMarketingSubscription(salonId);
        const batch = await this.repository.prepareBatch(salonId, campaignId, channel, limit);
        let sent = 0;
        let failed = 0;
        for (const recipient of batch.recipients) {
            const title = this.render(batch.campaign.titleTemplate, recipient.fullName);
            const body = this.render(batch.campaign.bodyTemplate, recipient.fullName);
            try {
                if (channel === 'IN_APP') {
                    await this.repository.createInAppDelivery(
                        recipient.deliveryId,
                        campaignId,
                        salonId,
                        recipient,
                        title,
                        body,
                        batch.campaign.priority,
                        batch.campaign.templateId
                    );
                } else if (channel === 'EMAIL') {
                    if (!recipient.email) throw new ApiError(409, 'Customer email is unavailable');
                    const providerReference = await this.email.sendMarketingEmail(recipient.email, title, body);
                    await this.repository.markDelivery(recipient.deliveryId, 'SENT', providerReference);
                } else {
                    if (!recipient.phoneNumber) throw new ApiError(409, 'Customer phone number is unavailable');
                    const providerReference = await this.whatsapp.sendApprovedMarketingTemplate({
                        to: recipient.phoneNumber,
                        body,
                    });
                    await this.repository.markDelivery(recipient.deliveryId, 'SENT', providerReference);
                }
                sent += 1;
            } catch (error) {
                logger.warn(
                    {
                        campaignId,
                        deliveryId: recipient.deliveryId,
                        errorType: error instanceof Error ? error.name : 'UnknownError',
                    },
                    'Marketing delivery failed'
                );
                await this.repository.markDelivery(recipient.deliveryId, 'FAILED');
                failed += 1;
            }
        }
        await this.repository.completeCampaignBatch(campaignId, salonId, channel);
        return {
            channel,
            attempted: batch.recipients.length,
            sent,
            failed,
            retryLimit: 3,
        };
    }

    private async requireMarketingSubscription(salonId: string) {
        if (!(await this.repository.checkMarketingSubscription(salonId))) {
            throw new ApiError(403, 'The marketing add-on is not active for this salon');
        }
    }

    private render(template: string, customerName: string) {
        return template.replace(/\{\{\s*name\s*\}\}/gi, customerName);
    }
}
