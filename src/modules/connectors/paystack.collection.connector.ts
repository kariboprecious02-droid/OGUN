/**
 * Paystack connector for non-M-Pesa collections (§5.1).
 *
 * Used for Airtel Money and any other non-M-Pesa methods enabled
 * on a merchant.  M-Pesa never routes through Paystack.
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'node:crypto';
import { config } from '@/infra/config';
import { logger } from '@/infra/logger';
import { timingSafeEquals } from '@/infra/crypto';
import {
  CollectionConnector,
  CollectionConnectorRequest,
  ConnectorResult,
  NormalizedCollectionStatus,
  ParsedWebhook,
} from './types';

export class PaystackCollectionConnector implements CollectionConnector {
  readonly name = 'paystack';
  readonly supportedMethods = ['airtel'];

  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.paystack.baseUrl,
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async initiateCollection(
    req: CollectionConnectorRequest,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    try {
      // Paystack "charge" endpoint for mobile money.
      const body = {
        email:
          req.customer.email ??
          `customer-${req.collection_id}@ogun.local`,
        amount: req.amount, // kobo-equivalent (Paystack expects smallest unit)
        currency: req.currency,
        mobile_money: {
          phone: req.customer.phone,
          provider: req.method === 'airtel' ? 'airtel' : req.method,
        },
        reference: req.collection_id,
        metadata: req.metadata ?? {},
      };
      const { data } = await this.http.post('/charge', body);
      const resp = data as { status: boolean; data?: { reference?: string; status?: string; display_text?: string } };
      const providerRef = resp.data?.reference ?? req.collection_id;
      const s = resp.data?.status ?? (resp.status ? 'pending' : 'failed');
      return {
        normalized_status: this.mapPaystackChargeStatus(s),
        provider_reference: providerRef,
        raw_payload: resp as Record<string, unknown>,
        error_code: resp.status ? null : 'paystack_error',
        error_message: resp.status ? null : resp.data?.display_text ?? 'Charge failed',
        next_action: resp.status ? 'wait' : 'escalate',
      };
    } catch (err) {
      logger.error({ err }, 'paystack initiateCollection failed');
      return {
        normalized_status: 'failed',
        provider_reference: req.collection_id,
        raw_payload: { error: (err as Error).message },
        error_code: 'provider_timeout',
        error_message: 'Paystack charge request failed',
        next_action: 'escalate',
      };
    }
  }

  private mapPaystackChargeStatus(s: string): NormalizedCollectionStatus {
    switch (s) {
      case 'success':
        return 'succeeded';
      case 'failed':
      case 'abandoned':
        return 'failed';
      case 'pending':
      case 'send_otp':
      case 'send_pin':
      case 'send_phone':
      case 'send_birthday':
      case 'send_address':
      case 'pay_offline':
      case 'open_url':
      default:
        return 'processing';
    }
  }

  async getCollectionStatus(
    providerRef: string,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    try {
      const { data } = await this.http.get(`/charge/${providerRef}`);
      const resp = data as { data?: { status?: string } };
      return {
        normalized_status: this.mapPaystackChargeStatus(resp.data?.status ?? 'pending'),
        provider_reference: providerRef,
        raw_payload: resp as Record<string, unknown>,
        error_code: null,
        error_message: null,
        next_action: null,
      };
    } catch (err) {
      return {
        normalized_status: 'pending',
        provider_reference: providerRef,
        raw_payload: { error: (err as Error).message },
        error_code: null,
        error_message: null,
        next_action: 'poll',
      };
    }
  }

  parseWebhook(payload: Buffer): ParsedWebhook {
    const body = JSON.parse(payload.toString('utf8')) as {
      event?: string;
      data?: { reference?: string; status?: string; gateway_response?: string };
    };
    const event = body.event ?? '';
    let normalized: NormalizedCollectionStatus = 'pending';
    if (event === 'charge.success') normalized = 'succeeded';
    else if (event === 'charge.failed') normalized = 'failed';
    else normalized = this.mapPaystackChargeStatus(body.data?.status ?? 'pending');

    return {
      provider_reference: body.data?.reference ?? '',
      normalized_status: normalized,
      failure_reason: normalized === 'failed' ? body.data?.gateway_response : undefined,
      raw: body as Record<string, unknown>,
    };
  }

  validateWebhookSignature(payload: Buffer, headers: Record<string, string>): boolean {
    const sig = headers['x-paystack-signature'] ?? '';
    if (!sig) return false;
    const computed = crypto
      .createHmac('sha512', config.paystack.secretKey)
      .update(payload)
      .digest('hex');
    return timingSafeEquals(sig, computed);
  }
}
