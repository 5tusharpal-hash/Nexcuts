import { env } from '../../config/env.js';

export interface WhatsAppOtp {
  to: string;
  code: string;
}

export interface WhatsAppMessage {
  to: string;
  body: string;
}

export class WhatsAppIntegration {
  private get apiUrl(): string {
    if (!env.META_WHATSAPP_API_VERSION || !env.META_WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error('WhatsApp provider is not configured');
    }
    return `https://graph.facebook.com/${env.META_WHATSAPP_API_VERSION}/${env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;
  }

  private get headers(): Record<string, string> {
    if (!env.META_WHATSAPP_ACCESS_TOKEN) {
      throw new Error('WhatsApp provider is not configured');
    }
    return {
      Authorization: `Bearer ${env.META_WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    };
  }

  async sendOtp({ to, code }: WhatsAppOtp): Promise<void> {
    if (env.AUTH_OTP_DELIVERY === 'mock') return;

    if (!env.META_WHATSAPP_OTP_TEMPLATE) throw new Error('WhatsApp OTP template is not configured');

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.slice(1),
        type: 'template',
        template: {
          name: env.META_WHATSAPP_OTP_TEMPLATE,
          language: { code: env.META_WHATSAPP_OTP_LANGUAGE },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            {
              type: 'button',
              sub_type: 'copy_code',
              index: '0',
              parameters: [{ type: 'text', text: code }],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`WhatsApp OTP provider returned HTTP ${response.status}`);
    }
  }

  async sendMessage({ to, body }: WhatsAppMessage): Promise<void> {
    if (env.AUTH_OTP_DELIVERY === 'mock') {
      throw new Error('WhatsApp messaging is disabled in mock delivery mode');
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.startsWith('+') ? to.slice(1) : to,
        type: 'text',
        text: { body },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`WhatsApp provider returned HTTP ${response.status}`);
    }
  }

  async sendApprovedMarketingTemplate({ to, body }: WhatsAppMessage): Promise<string | undefined> {
    if (!env.META_WHATSAPP_MARKETING_TEMPLATE) {
      throw new Error('WhatsApp marketing template is not configured');
    }
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.startsWith('+') ? to.slice(1) : to,
        type: 'template',
        template: {
          name: env.META_WHATSAPP_MARKETING_TEMPLATE,
          language: { code: env.META_WHATSAPP_MARKETING_LANGUAGE },
          components: [{
            type: 'body',
            parameters: [{ type: 'text', text: body }],
          }],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`WhatsApp provider returned HTTP ${response.status}`);
    }
    const result = await response.json() as { messages?: Array<{ id?: string }> };
    return result.messages?.[0]?.id;
  }
}
