import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { ApiError } from '../../shared/errors/ApiError.js';
import type { DeliveryLog, MarketingCampaign } from './marketing.types.js';

type MarketingChannel = 'IN_APP' | 'EMAIL' | 'WHATSAPP';

interface DeliveryRecipient extends QueryResultRow {
    deliveryId: string;
    customerAccountId: string;
    fullName: string;
    email: string | null;
    phoneNumber: string | null;
}

interface CampaignRow extends QueryResultRow {
    id: string;
    branchId: string;
    name: string;
    templateId: string;
    targetCriteria: Record<string, unknown>;
    scheduledAt: Date | null;
    status: MarketingCampaign['status'];
}

interface DeliveryRow extends QueryResultRow {
    id: string;
    campaignId: string;
    userId: string;
    channel: DeliveryLog['channel'];
    status: DeliveryLog['status'];
    sentAt: Date | null;
    attemptCount: number;
    lastAttemptAt: Date | null;
    lastError: string | null;
}

export class MarketingRepository {
    constructor(private readonly pool: Pool) {}

    async createCampaign(
        salonId: string,
        name: string,
        titleTemplate: string,
        bodyTemplate: string,
        scheduledAt?: Date,
        channels?: MarketingChannel[]
    ): Promise<MarketingCampaign> {
        return this.withTransaction(async (client) => {
            const templateId = randomUUID();
            await client.query(
                `INSERT INTO notification_templates (id, title_template, body_template)
                 VALUES ($1, $2, $3)`,
                [templateId, titleTemplate, bodyTemplate]
            );
            const targetCriteria = { channels: channels ?? ['IN_APP'] };
            const result = await client.query<CampaignRow>(
                `INSERT INTO salon_marketing_campaigns
                    (salon_id, name, template_id, target_criteria, scheduled_at, status)
                 VALUES ($1, $2, $3, $4::jsonb, $5, CASE WHEN $5 IS NULL THEN 'DRAFT' ELSE 'SCHEDULED' END)
                 RETURNING id, salon_id AS "branchId", name, template_id AS "templateId",
                           target_criteria AS "targetCriteria", scheduled_at AS "scheduledAt", status`,
                [salonId, name, templateId, JSON.stringify(targetCriteria), scheduledAt ?? null]
            );
            const campaign = result.rows[0];
            return { ...campaign, scheduledAt: campaign.scheduledAt ?? undefined };
        });
    }

    async checkMarketingSubscription(salonId: string): Promise<boolean> {
        const result = await this.pool.query<{ enabled: boolean }>(
            `SELECT EXISTS (
                SELECT 1
                FROM platform_salon_addons AS salon_addon
                JOIN platform_addons AS addon ON addon.id = salon_addon.addon_id
                WHERE salon_addon.salon_id = $1
                  AND addon.key = 'marketing'
                  AND addon.is_active = TRUE
                  AND salon_addon.status = 'ACTIVE'
             ) AS enabled`,
            [salonId]
        );
        return result.rows[0].enabled;
    }

    async prepareBatch(
        salonId: string,
        campaignId: string,
        channel: MarketingChannel,
        limit: number
    ) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const campaignResult = await client.query<{
                id: string;
                templateId: string;
                status: string;
                titleTemplate: string;
                bodyTemplate: string;
                priority: string;
            }>(
                `SELECT campaign.id, campaign.template_id AS "templateId", campaign.status,
                        template.title_template AS "titleTemplate",
                        template.body_template AS "bodyTemplate", template.priority
                 FROM salon_marketing_campaigns AS campaign
                 JOIN notification_templates AS template ON template.id = campaign.template_id
                 WHERE campaign.id = $1 AND campaign.salon_id = $2
                 FOR UPDATE OF campaign`,
                [campaignId, salonId]
            );
            const campaign = campaignResult.rows[0];
            if (!campaign) throw new ApiError(404, 'Marketing campaign not found');
            if (campaign.status === 'CANCELLED') {
                throw new ApiError(409, 'Cancelled marketing campaigns cannot be delivered');
            }

            const consentScope = channel === 'IN_APP' ? 'ALL' : channel;
            await client.query(
                `UPDATE salon_marketing_deliveries
                 SET status = 'FAILED',
                     last_error = 'Previous delivery attempt expired',
                     updated_at = CURRENT_TIMESTAMP
                 WHERE campaign_id = $1 AND channel = $2
                   AND status = 'SENDING'
                   AND last_attempt_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'`,
                [campaignId, channel]
            );
            await client.query(
                `INSERT INTO salon_marketing_deliveries (campaign_id, customer_account_id, channel)
                 SELECT $1, account.id, $3
                 FROM accounts AS account
                 JOIN customer_profiles AS profile ON profile.account_id = account.id
                 JOIN LATERAL (
                     SELECT consent.is_granted
                     FROM salon_marketing_consents AS consent
                     WHERE consent.salon_id = $2
                       AND consent.customer_account_id = account.id
                       AND consent.consent_scope IN ('ALL', $4)
                     ORDER BY consent.recorded_at DESC, consent.id DESC
                     LIMIT 1
                 ) AS current_consent ON current_consent.is_granted = TRUE
                 LEFT JOIN customer_notification_preferences AS preference
                   ON preference.customer_account_id = account.id
                 WHERE account.status = 'ACTIVE'
                   AND account.deleted_at IS NULL
                   AND (
                       ($3 = 'IN_APP')
                       OR ($3 = 'EMAIL' AND account.email IS NOT NULL
                           AND COALESCE(preference.email_enabled, TRUE))
                       OR ($3 = 'WHATSAPP' AND account.phone_number IS NOT NULL
                           AND COALESCE(preference.whatsapp_enabled, FALSE))
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM salon_marketing_deliveries AS existing
                       WHERE existing.campaign_id = $1
                         AND existing.customer_account_id = account.id
                         AND existing.channel = $3
                   )
                 ORDER BY account.id
                 LIMIT $5
                 ON CONFLICT (campaign_id, customer_account_id, channel) DO NOTHING`,
                [campaignId, salonId, channel, consentScope, limit]
            );

            const claimed = await client.query<DeliveryRecipient>(
                `WITH candidates AS (
                    SELECT delivery.id
                    FROM salon_marketing_deliveries AS delivery
                    JOIN accounts AS account ON account.id = delivery.customer_account_id
                    LEFT JOIN customer_notification_preferences AS preference
                      ON preference.customer_account_id = account.id
                    JOIN LATERAL (
                        SELECT consent.is_granted
                        FROM salon_marketing_consents AS consent
                        WHERE consent.salon_id = $2
                          AND consent.customer_account_id = account.id
                          AND consent.consent_scope IN ('ALL', $4)
                        ORDER BY consent.recorded_at DESC, consent.id DESC
                        LIMIT 1
                    ) AS current_consent ON current_consent.is_granted = TRUE
                    WHERE delivery.campaign_id = $1
                      AND delivery.channel = $3
                      AND delivery.status IN ('PENDING', 'FAILED')
                      AND delivery.attempt_count < 3
                      AND account.status = 'ACTIVE' AND account.deleted_at IS NULL
                      AND (
                          ($3 = 'IN_APP')
                          OR ($3 = 'EMAIL' AND account.email IS NOT NULL
                              AND COALESCE(preference.email_enabled, TRUE))
                          OR ($3 = 'WHATSAPP' AND account.phone_number IS NOT NULL
                              AND COALESCE(preference.whatsapp_enabled, FALSE))
                      )
                    ORDER BY delivery.created_at, delivery.id
                    LIMIT $5
                    FOR UPDATE OF delivery SKIP LOCKED
                 )
                 UPDATE salon_marketing_deliveries AS delivery
                 SET status = 'SENDING',
                     attempt_count = attempt_count + 1,
                     last_attempt_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP,
                     last_error = NULL
                 FROM candidates
                 WHERE delivery.id = candidates.id
                 RETURNING delivery.id AS "deliveryId",
                           delivery.customer_account_id AS "customerAccountId"`,
                [campaignId, salonId, channel, consentScope, limit]
            );
            const customerIds = claimed.rows.map((row) => row.customerAccountId);
            let recipients: DeliveryRecipient[] = [];
            if (customerIds.length > 0) {
                const recipientResult = await client.query<DeliveryRecipient>(
                    `SELECT delivery.id AS "deliveryId",
                            account.id AS "customerAccountId",
                            account.full_name AS "fullName",
                            account.email,
                            account.phone_number AS "phoneNumber"
                     FROM salon_marketing_deliveries AS delivery
                     JOIN accounts AS account ON account.id = delivery.customer_account_id
                     WHERE delivery.id = ANY($1::uuid[])`,
                    [claimed.rows.map((row) => row.deliveryId)]
                );
                recipients = recipientResult.rows;
            }
            await client.query(
                `UPDATE salon_marketing_campaigns
                 SET status = 'SENDING', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [campaignId, salonId]
            );
            await client.query('COMMIT');
            return {
                campaign,
                recipients,
                channel,
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async markDelivery(
        deliveryId: string,
        status: 'SENT' | 'FAILED',
        providerReference?: string
    ) {
        await this.pool.query(
            `UPDATE salon_marketing_deliveries
             SET status = $2, sent_at = CASE WHEN $2 = 'SENT' THEN CURRENT_TIMESTAMP ELSE sent_at END,
                 provider_reference = COALESCE($3, provider_reference),
                 last_error = CASE WHEN $2 = 'FAILED' THEN 'Provider delivery failed' ELSE NULL END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'SENDING'`,
            [deliveryId, status, providerReference ?? null]
        );
    }

    async createInAppDelivery(
        deliveryId: string,
        campaignId: string,
        salonId: string,
        recipient: DeliveryRecipient,
        title: string,
        body: string,
        priority: string,
        templateId: string
    ) {
        return this.withTransaction(async (client) => {
            const notification = await client.query<{ id: string }>(
                `INSERT INTO account_notifications (
                    account_id, salon_id, template_id, title, body, channel,
                    priority, status, metadata
                 ) VALUES ($1, $2, $3, $4, $5, 'IN_APP', $6, 'SENT', $7)
                 RETURNING id`,
                [
                    recipient.customerAccountId,
                    salonId,
                    templateId,
                    title,
                    body,
                    priority,
                    JSON.stringify({ campaignId }),
                ]
            );
            await client.query(
                `UPDATE salon_marketing_deliveries
                 SET status = 'SENT', sent_at = CURRENT_TIMESTAMP,
                     provider_reference = $2, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status = 'SENDING'`,
                [deliveryId, notification.rows[0].id]
            );
        });
    }

    async completeCampaignBatch(campaignId: string, salonId: string, channel: MarketingChannel) {
        const consentScope = channel === 'IN_APP' ? 'ALL' : channel;
        await this.pool.query(
            `UPDATE salon_marketing_campaigns AS campaign
             SET status = CASE
                    WHEN EXISTS (
                        SELECT 1 FROM salon_marketing_deliveries AS delivery
                        WHERE delivery.campaign_id = campaign.id
                          AND (
                              delivery.status IN ('PENDING', 'SENDING')
                              OR (delivery.status = 'FAILED' AND delivery.attempt_count < 3)
                          )
                    ) OR EXISTS (
                        SELECT 1
                        FROM accounts AS account
                        JOIN customer_profiles AS profile ON profile.account_id = account.id
                        JOIN LATERAL (
                            SELECT consent.is_granted
                            FROM salon_marketing_consents AS consent
                            WHERE consent.salon_id = campaign.salon_id
                              AND consent.customer_account_id = account.id
                              AND consent.consent_scope IN ('ALL', $3)
                            ORDER BY consent.recorded_at DESC, consent.id DESC
                            LIMIT 1
                        ) AS current_consent ON current_consent.is_granted = TRUE
                        LEFT JOIN customer_notification_preferences AS preference
                          ON preference.customer_account_id = account.id
                        WHERE account.status = 'ACTIVE'
                          AND account.deleted_at IS NULL
                          AND (
                              ($3 = 'ALL')
                              OR ($3 = 'EMAIL' AND account.email IS NOT NULL
                                  AND COALESCE(preference.email_enabled, TRUE))
                              OR ($3 = 'WHATSAPP' AND account.phone_number IS NOT NULL
                                  AND COALESCE(preference.whatsapp_enabled, FALSE))
                          )
                          AND NOT EXISTS (
                              SELECT 1 FROM salon_marketing_deliveries AS delivery
                              WHERE delivery.campaign_id = campaign.id
                                AND delivery.customer_account_id = account.id
                                AND delivery.channel = $4
                          )
                    ) THEN 'SENDING'
                    ELSE 'COMPLETED'
                 END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE campaign.id = $1 AND campaign.salon_id = $2`,
            [campaignId, salonId, consentScope, channel]
        );
    }

    async listDeliveries(
        salonId: string,
        campaignId: string,
        limit: number,
        offset: number
    ): Promise<{ items: DeliveryLog[]; total: number }> {
        const [items, count] = await Promise.all([
            this.pool.query<DeliveryRow>(
                `SELECT delivery.id, delivery.campaign_id AS "campaignId",
                        delivery.customer_account_id AS "userId", delivery.channel,
                        delivery.status, delivery.sent_at AS "sentAt",
                        delivery.attempt_count AS "attemptCount",
                        delivery.last_attempt_at AS "lastAttemptAt",
                        delivery.last_error AS "lastError"
                 FROM salon_marketing_deliveries AS delivery
                 JOIN salon_marketing_campaigns AS campaign ON campaign.id = delivery.campaign_id
                 WHERE campaign.salon_id = $1 AND campaign.id = $2
                 ORDER BY delivery.created_at DESC
                 LIMIT $3 OFFSET $4`,
                [salonId, campaignId, limit, offset]
            ),
            this.pool.query<{ total: number }>(
                `SELECT COUNT(*)::int AS total
                 FROM salon_marketing_deliveries AS delivery
                 JOIN salon_marketing_campaigns AS campaign ON campaign.id = delivery.campaign_id
                 WHERE campaign.salon_id = $1 AND campaign.id = $2`,
                [salonId, campaignId]
            ),
        ]);
        return { items: items.rows, total: count.rows[0].total };
    }

    async currentConsent(salonId: string, customerAccountId: string) {
        const result = await this.pool.query<{
            isGranted: boolean;
            recordedAt: Date;
            source: string;
            consentTextVersion: string;
        }>(
            `SELECT is_granted AS "isGranted", recorded_at AS "recordedAt",
                    source, consent_text_version AS "consentTextVersion"
             FROM salon_marketing_consents
             WHERE salon_id = $1 AND customer_account_id = $2 AND consent_scope = 'ALL'
             ORDER BY recorded_at DESC, id DESC
             LIMIT 1`,
            [salonId, customerAccountId]
        );
        return result.rows[0] ?? { isGranted: false, recordedAt: null, source: null, consentTextVersion: null };
    }

    async optOut(salonId: string, customerAccountId: string) {
        await this.pool.query(
            `INSERT INTO salon_marketing_consents (
                salon_id, customer_account_id, consent_scope, is_granted,
                source, consent_text_version
             ) VALUES ($1, $2, 'ALL', FALSE, 'CUSTOMER_SETTINGS', 'queue-marketing-v1')`,
            [salonId, customerAccountId]
        );
    }

    private async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
