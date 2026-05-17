/**
 * Paystack collection connector — default provider for all collection
 * methods (M-Pesa, Airtel, Till, Card, Bank). Routes charges through
 * Paystack's unified charge API.
 *
 * Mobile money methods (mpesa, airtel) use POST /charge with a
 * mobile_money body. Card and bank use POST /transaction/initialize
 * which returns an authorization URL for the payer.
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'node:crypto';
import { config } from '@/infra/config';
import { logger } from '@/infra/logger';
import { timingSafeEquals } from '@/infra/crypto';
import { attachPaystackInterceptors } from './paystackInterceptors';
import {
  CollectionConnector,
  CollectionConnectorRequest,
  ConnectorResult,
  NormalizedCollectionStatus,
  ParsedWebhook,
} from './types';

function normalizeKEPhone(phone: string): string {
  let p = phone.replace(/[\s\-()]/g, '');
  if (p.startsWith('+254')) return p;
  if (p.startsWith('254') && p.length >= 12) return '+' + p;
  if (p.startsWith('0') && p.length === 10) return '+254' + p.slice(1);
  return p;
}

export class PaystackCollectionConnector implements CollectionConnector {
  readonly name = 'paystack';
  readonly supportedMethods = ['mpesa', 'airtel', 'till', 'card', 'bank'];

  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.paystack.baseUrl,
      timeout: 10_000,
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
    attachPaystackInterceptors(this.http, 'paystack-collection');
  }

  async initiateCollection(
    req: CollectionConnectorRequest,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    try {
      if (req.method === 'card' || req.method === 'bank') {
        return this.initiateTransactionFlow(req);
      }
      return this.initiateMobileMoneyFlow(req);
    } catch (err) {
      const axiosErr = err as import('axios').AxiosError;
      const hasResponse = !!axiosErr.response;
      const status = axiosErr.response?.status;
      const respData = axiosErr.response?.data as Record<string, unknown> | undefined;

      logger.error({ err, method: req.method, status, err_code: axiosErr.code },
        'paystack initiateCollection failed');

      if (hasResponse && status && status >= 400 && status < 500) {
        return {
          normalized_status: 'failed',
          provider_reference: req.collection_id,
          raw_payload: { error: (err as Error).message, response: respData },
          error_code: `paystack_${status}`,
          error_message: (respData?.message as string) ?? 'Paystack rejected the request',
          next_action: null,
        };
      }

      return {
        normalized_status: 'failed',
        provider_reference: req.collection_id,
        raw_payload: { error: (err as Error).message, err_code: axiosErr.code },
        error_code: axiosErr.code === 'ECONNABORTED' ? 'provider_timeout' : 'provider_error',
        error_message: 'Paystack charge request failed',
        next_action: 'escalate',
      };
    }
  }

  private async initiateMobileMoneyFlow(
    req: CollectionConnectorRequest,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    const provider = req.method === 'airtel' ? 'airtel' : 'mpesa';
    const body = {
      email:
        req.customer.email ??
        `customer-${req.collection_id}@ogun-pay.io`,
      // Paystack /charge expects subunits (cents for KES) per general API docs.
      // TODO: verify KE mobile_money specifically — co-worker diagnostic
      // flagged that M-Pesa docs example shows whole KES. If so, divide by 100.
      amount: req.amount,
      currency: req.currency,
      mobile_money: {
        phone: normalizeKEPhone(req.customer.phone),
        provider,
      },
      reference: req.collection_id,
      metadata: req.metadata ?? {},
    };
    const { data } = await this.http.post('/charge', body);
    const resp = data as {
      status: boolean;
      data?: { reference?: string; status?: string; display_text?: string };
    };
    const providerRef = resp.data?.reference ?? req.collection_id;
    const s = resp.data?.status ?? (resp.status ? 'pending' : 'failed');
    return {
      normalized_status: this.mapChargeStatus(s),
      provider_reference: providerRef,
      raw_payload: resp as Record<string, unknown>,
      error_code: resp.status ? null : 'paystack_error',
      error_message: resp.status ? null : resp.data?.display_text ?? 'Charge failed',
      next_action: resp.status ? 'wait' : 'escalate',
    };
  }

  private async initiateTransactionFlow(
    req: CollectionConnectorRequest,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    const body: Record<string, unknown> = {
      email:
        req.customer.email ??
        `customer-${req.collection_id}@ogun-pay.io`,
      amount: req.amount,
      currency: req.currency,
      reference: req.collection_id,
      metadata: req.metadata ?? {},
      callback_url: req.callback_url,
    };
    if (req.method === 'bank') {
      body.channels = ['bank_transfer'];
    } else {
      body.channels = ['card'];
    }
    const { data } = await this.http.post('/transaction/initialize', body);
    const resp = data as {
      status: boolean;
      data?: { reference?: string; authorization_url?: string; access_code?: string };
    };
    return {
      normalized_status: 'pending',
      provider_reference: resp.data?.reference ?? req.collection_id,
      raw_payload: resp as Record<string, unknown>,
      error_code: resp.status ? null : 'paystack_error',
      error_message: resp.status ? null : 'Transaction initialization failed',
      next_action: resp.data?.authorization_url ? 'redirect' : 'wait',
    };
  }

  private mapChargeStatus(s: string): NormalizedCollectionStatus {
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
      const { data } = await this.http.get(
        `/transaction/verify/${providerRef}`,
      );
      const resp = data as { data?: { status?: string; gateway_response?: string; reference?: string } };
      const txStatus = resp.data?.status ?? 'pending';
      const normalized = this.mapChargeStatus(txStatus);
      return {
        normalized_status: normalized,
        provider_reference: resp.data?.reference ?? providerRef,
        raw_payload: resp as Record<string, unknown>,
        error_code: normalized === 'failed' ? `paystack_${txStatus}` : null,
        error_message: resp.data?.gateway_response ?? null,
        next_action: null,
      };
    } catch (err) {
      const axiosErr = err as import('axios').AxiosError;
      const status = axiosErr.response?.status;

      if (status && status >= 400 && status < 500) {
        return {
          normalized_status: 'failed',
          provider_reference: providerRef,
          raw_payload: { error: (err as Error).message, status },
          error_code: `paystack_${status}`,
          error_message: (axiosErr.response?.data as Record<string, unknown>)?.message as string ?? 'provider rejected',
          next_action: null,
        };
      }

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
    else normalized = this.mapChargeStatus(body.data?.status ?? 'pending');

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

  async refundTransaction(input: {
    transaction_reference: string;
    amount?: number;
  }): Promise<{ status: boolean; refund_id?: number; refund_reference?: string; message?: string }> {
    try {
      const { data } = await this.http.post('/refund', {
        transaction: input.transaction_reference,
        ...(input.amount != null ? { amount: input.amount } : {}),
      });
      const resp = data as { status: boolean; data?: { id?: number; transaction?: { reference?: string }; status?: string }; message?: string };
      return {
        status: resp.status,
        refund_id: resp.data?.id,
        refund_reference: resp.data?.transaction?.reference,
        message: resp.message,
      };
    } catch (err) {
      const axiosErr = err as import('axios').AxiosError;
      logger.error({ err, status: axiosErr.response?.status }, 'paystack refund failed');
      return {
        status: false,
        message: (axiosErr.response?.data as Record<string, unknown>)?.message as string ?? 'refund request failed',
      };
    }
  }

  async getRefundStatus(refundId: number): Promise<{
    status: string;
    amount: number;
    message?: string;
  }> {
    try {
      const { data } = await this.http.get(`/refund/${refundId}`);
      const resp = data as { status: boolean; data?: { status?: string; amount?: number }; message?: string };
      return {
        status: resp.data?.status ?? 'pending',
        amount: resp.data?.amount ?? 0,
        message: resp.message,
      };
    } catch (err) {
      return { status: 'pending', amount: 0, message: (err as Error).message };
    }
  }
}
