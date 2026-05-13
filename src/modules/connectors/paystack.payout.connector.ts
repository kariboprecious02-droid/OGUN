/**
 * Paystack payout connector (§6) — Mobile Money + Bank Transfer (KEPSS).
 *
 * Flow:
 *   1. Resolve / create a transfer recipient
 *   2. Initiate transfer with platform provider_reference
 *   3. Normalize Paystack status → Ogun payout status (§6.3)
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'node:crypto';
import { config } from '@/infra/config';
import { logger } from '@/infra/logger';
import { timingSafeEquals } from '@/infra/crypto';
import { attachPaystackInterceptors } from './paystackInterceptors';
import {
  PayoutConnector,
  PayoutConnectorRequest,
  ConnectorResult,
  NormalizedPayoutStatus,
  ParsedWebhook,
} from './types';

export class PaystackPayoutConnector implements PayoutConnector {
  readonly name = 'paystack';
  readonly supportedMethods = ['mobile_money', 'bank_transfer'];

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
    attachPaystackInterceptors(this.http, 'paystack-payout');
  }

  /**
   * Create or reuse a Paystack transfer recipient. Caller caches the
   * recipient_code in the Beneficiary row to avoid round-trips.
   */
  async resolveRecipient(input: {
    type: 'mobile_money' | 'nuban';
    name: string;
    account_number: string;
    bank_code?: string;
    currency?: string;
  }): Promise<string> {
    const body = {
      type: input.type,
      name: input.name,
      account_number: input.account_number,
      bank_code: input.bank_code,
      currency: input.currency ?? 'KES',
    };
    const { data } = await this.http.post('/transferrecipient', body);
    const resp = data as { status: boolean; data?: { recipient_code?: string }; message?: string };
    if (!resp.status || !resp.data?.recipient_code) {
      throw new Error(`Paystack recipient creation failed: ${resp.message}`);
    }
    return resp.data.recipient_code;
  }

  async initiatePayout(
    req: PayoutConnectorRequest,
  ): Promise<ConnectorResult<NormalizedPayoutStatus>> {
    try {
      const recipient = req.beneficiary.provider_recipient_code;
      if (!recipient) {
        return {
          normalized_status: 'failed',
          provider_reference: req.payout_id,
          raw_payload: {},
          error_code: 'missing_recipient_code',
          error_message: 'Paystack recipient code not resolved',
          next_action: 'escalate',
        };
      }
      const body = {
        source: 'balance',
        amount: req.amount, // recipient_amount — Paystack deducts from platform balance
        recipient,
        reason: req.reason ?? 'Ogun payout',
        reference: req.payout_id,
        currency: req.currency,
      };
      const { data } = await this.http.post('/transfer', body);
      const resp = data as {
        status: boolean;
        data?: { transfer_code?: string; status?: string; reference?: string };
        message?: string;
      };
      const providerRef = resp.data?.reference ?? req.payout_id;
      const transferCode = resp.data?.transfer_code;
      const rawStatus = resp.data?.status ?? (resp.status ? 'pending' : 'failed');
      return {
        normalized_status: this.mapTransferStatus(rawStatus),
        provider_reference: providerRef,
        raw_payload: { ...resp, transfer_code: transferCode } as Record<string, unknown>,
        error_code: resp.status ? null : 'paystack_error',
        error_message: resp.status ? null : resp.message ?? 'Transfer rejected',
        next_action: resp.status ? 'wait' : 'escalate',
      };
    } catch (err) {
      logger.error({ err }, 'paystack initiatePayout failed');
      return {
        normalized_status: 'failed',
        provider_reference: req.payout_id,
        raw_payload: { error: (err as Error).message },
        error_code: 'provider_timeout',
        error_message: 'Paystack transfer request failed',
        next_action: 'escalate',
      };
    }
  }

  /**
   * Paystack status normalization — §6.3.
   */
  private mapTransferStatus(s: string): NormalizedPayoutStatus {
    switch (s) {
      case 'pending':
      case 'received':
        return 'processing';
      case 'otp':
        return 'pending_approval';
      case 'success':
        return 'succeeded';
      case 'reversed':
        return 'reversed';
      case 'failed':
      case 'abandoned':
      case 'blocked':
      case 'rejected':
        return 'failed';
      default:
        return 'processing';
    }
  }

  async getPayoutStatus(providerRef: string): Promise<ConnectorResult<NormalizedPayoutStatus>> {
    try {
      const { data } = await this.http.get(`/transfer/${providerRef}`);
      const resp = data as { data?: { status?: string } };
      return {
        normalized_status: this.mapTransferStatus(resp.data?.status ?? 'pending'),
        provider_reference: providerRef,
        raw_payload: resp as Record<string, unknown>,
        error_code: null,
        error_message: null,
        next_action: null,
      };
    } catch (err) {
      return {
        normalized_status: 'processing',
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
      data?: { reference?: string; status?: string; failures?: unknown; reason?: string };
    };
    const event = body.event ?? '';
    let normalized: NormalizedPayoutStatus = 'processing';
    if (event === 'transfer.success') normalized = 'succeeded';
    else if (event === 'transfer.failed') normalized = 'failed';
    else if (event === 'transfer.reversed') normalized = 'reversed';
    else normalized = this.mapTransferStatus(body.data?.status ?? 'pending');

    return {
      provider_reference: body.data?.reference ?? '',
      normalized_status: normalized,
      failure_reason: normalized === 'failed' ? body.data?.reason : undefined,
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
