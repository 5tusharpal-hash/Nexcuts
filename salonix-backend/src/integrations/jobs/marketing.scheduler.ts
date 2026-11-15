import { pool } from '../../bootstrap/db.connect.js';
import { EmailIntegration } from '../email/email.integration.js';
import { WhatsAppIntegration } from '../whatsapp/whatsapp.integration.js';
import { MarketingRepository } from '../../modules/marketing/marketing.repository.js';
import { MarketingService } from '../../modules/marketing/marketing.service.js';
import { logger } from '../../bootstrap/logger.js';

type MarketingChannel = 'IN_APP' | 'EMAIL' | 'WHATSAPP';

export async function dispatchDueMarketingCampaigns(): Promise<number> {
    const repository = new MarketingRepository(pool);
    const service = new MarketingService(repository, new EmailIntegration(), new WhatsAppIntegration());
    await pool.query(
        `UPDATE salon_marketing_campaigns
         SET status = 'SCHEDULED', updated_at = CURRENT_TIMESTAMP
         WHERE status = 'SENDING'
           AND updated_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'`
    );

    const claimed = await pool.query<{ id: string; salonId: string; channels: MarketingChannel[] }>(
        `WITH due AS (
            SELECT id
            FROM salon_marketing_campaigns
            WHERE status = 'SCHEDULED' AND scheduled_at <= CURRENT_TIMESTAMP
            ORDER BY scheduled_at
            LIMIT 25
            FOR UPDATE SKIP LOCKED
         )
         UPDATE salon_marketing_campaigns campaign
         SET status = 'SENDING', updated_at = CURRENT_TIMESTAMP
         FROM due
         WHERE campaign.id = due.id
         RETURNING campaign.id, campaign.salon_id AS "salonId",
                   COALESCE(campaign.target_criteria->'channels', '["IN_APP"]'::jsonb) AS channels`
    );

    for (const campaign of claimed.rows) {
        try {
            for (const channel of campaign.channels) {
                await service.sendCampaign(campaign.salonId, campaign.id, channel, 100);
            }
        } catch (error) {
            logger.error({ campaignId: campaign.id, error }, 'Scheduled marketing campaign failed');
        }
    }
    return claimed.rows.length;
}
