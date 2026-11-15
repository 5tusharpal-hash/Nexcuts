import { env } from '../../config/env.js';
import { ApiError } from '../../shared/errors/ApiError.js';

export type PaymentProvider = 'RAZORPAY' | 'STRIPE';
export type ProviderPaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

export interface CheckoutRequest {
    paymentId: string;
    organizationId: string;
    invoiceNumbers: string[];
    amount: number;
}

export interface CheckoutSession {
    providerReference: string;
    checkoutUrl: string | null;
    expiresAt: Date | null;
    publicKey: string | null;
}

export interface ProviderPaymentStatusResult {
    status: ProviderPaymentStatus;
    amount: number | null;
    currency: string | null;
}

export class PlatformPaymentGateway {
    async createCheckout(
        provider: PaymentProvider,
        request: CheckoutRequest
    ): Promise<CheckoutSession> {
        return provider === 'STRIPE'
            ? this.createStripeCheckout(request)
            : this.createRazorpayOrder(request);
    }

    async getPaymentStatus(
        provider: PaymentProvider,
        providerReference: string
    ): Promise<ProviderPaymentStatusResult> {
        return provider === 'STRIPE'
            ? this.getStripePaymentStatus(providerReference)
            : this.getRazorpayPaymentStatus(providerReference);
    }

    private async createStripeCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
        if (!env.STRIPE_SECRET_KEY || !env.PLATFORM_BILLING_RETURN_URL) {
            throw new ApiError(503, 'Stripe billing is not configured');
        }
        const returnUrl = new URL(env.PLATFORM_BILLING_RETURN_URL);
        const successUrl = new URL(returnUrl);
        successUrl.searchParams.set('checkout', 'success');
        successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
        const cancelUrl = new URL(returnUrl);
        cancelUrl.searchParams.set('checkout', 'cancelled');
        const successUrlValue = successUrl.toString()
            .replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
        const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
        const form = new URLSearchParams({
            mode: 'payment',
            success_url: successUrlValue,
            cancel_url: cancelUrl.toString(),
            client_reference_id: request.paymentId,
            'line_items[0][quantity]': '1',
            'line_items[0][price_data][currency]': 'inr',
            'line_items[0][price_data][unit_amount]': String(Math.round(request.amount * 100)),
            'line_items[0][price_data][product_data][name]':
                `Salonix invoice payment (${request.invoiceNumbers.length} invoice(s))`,
            'metadata[payment_id]': request.paymentId,
            'metadata[organization_id]': request.organizationId,
            expires_at: String(expiresAt),
        });
        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Idempotency-Key': request.paymentId,
            },
            body: form,
            signal: AbortSignal.timeout(15_000),
        });
        const body = await response.json() as {
            id?: string;
            url?: string;
            expires_at?: number;
            error?: { message?: string };
        };
        if (!response.ok || !body.id || !body.url) {
            throw new ApiError(
                502,
                `Stripe checkout creation failed${body.error?.message ? `: ${body.error.message}` : ''}`
            );
        }
        return {
            providerReference: body.id,
            checkoutUrl: body.url,
            expiresAt: body.expires_at
                ? new Date(body.expires_at * 1000)
                : new Date(expiresAt * 1000),
            publicKey: null,
        };
    }

    private async createRazorpayOrder(request: CheckoutRequest): Promise<CheckoutSession> {
        if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
            throw new ApiError(503, 'Razorpay billing is not configured');
        }
        const response = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(
                    `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
                ).toString('base64')}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                amount: Math.round(request.amount * 100),
                currency: 'INR',
                receipt: request.paymentId,
                notes: {
                    payment_id: request.paymentId,
                    organization_id: request.organizationId,
                },
            }),
            signal: AbortSignal.timeout(15_000),
        });
        const body = await response.json() as {
            id?: string;
            error?: { description?: string };
        };
        if (!response.ok || !body.id) {
            throw new ApiError(
                502,
                `Razorpay order creation failed${body.error?.description ? `: ${body.error.description}` : ''}`
            );
        }
        return {
            providerReference: body.id,
            checkoutUrl: null,
            expiresAt: null,
            publicKey: env.RAZORPAY_KEY_ID,
        };
    }

    private async getStripePaymentStatus(
        sessionId: string
    ): Promise<ProviderPaymentStatusResult> {
        if (!env.STRIPE_SECRET_KEY) throw new ApiError(503, 'Stripe billing is not configured');
        const response = await fetch(
            `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
            {
                headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
                signal: AbortSignal.timeout(15_000),
            }
        );
        const body = await response.json() as {
            status?: string;
            payment_status?: string;
            amount_total?: number;
            currency?: string;
        };
        if (!response.ok) throw new ApiError(502, 'Stripe checkout status lookup failed');
        return {
            status: body.payment_status === 'paid'
                ? 'SUCCESS'
                : body.status === 'expired' ? 'FAILED' : 'PENDING',
            amount: typeof body.amount_total === 'number' ? body.amount_total / 100 : null,
            currency: body.currency?.toUpperCase() ?? null,
        };
    }

    private async getRazorpayPaymentStatus(
        orderId: string
    ): Promise<ProviderPaymentStatusResult> {
        if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
            throw new ApiError(503, 'Razorpay billing is not configured');
        }
        const response = await fetch(
            `https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`,
            {
                headers: {
                    Authorization: `Basic ${Buffer.from(
                        `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
                    ).toString('base64')}`,
                },
                signal: AbortSignal.timeout(15_000),
            }
        );
        const body = await response.json() as {
            status?: string;
            amount?: number;
            amount_paid?: number;
            currency?: string;
        };
        if (!response.ok) throw new ApiError(502, 'Razorpay order status lookup failed');
        return {
            status: body.status === 'paid' ? 'SUCCESS' : 'PENDING',
            amount: body.status === 'paid'
                ? (body.amount_paid ?? body.amount ?? 0) / 100
                : null,
            currency: body.currency?.toUpperCase() ?? null,
        };
    }
}
