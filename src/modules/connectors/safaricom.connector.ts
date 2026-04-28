/**
 * Safaricom Daraja connector for M-Pesa collections.
 *
 * OPT-IN ONLY — Paystack is the default provider for all methods.
 * To route M-Pesa through Daraja instead of Paystack, set:
 *   COLLECTION_PROVIDER_OVERRIDES=mpesa=safaricom
 *
 * Implements:
 *   - OAuth token fetching (cached in-process, expires 1h)
 *   - STK Push initiation
 *   - Transaction status query
 *   - Webhook callback parsing (Safaricom delivers unsigned callbacks
 *     to the configured confirmation URL; verified via correlating
 *     CheckoutRequestID + host allowlist rather than HMAC).
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '@/infra/config';
import { logger } from '@/infra/logger';
import { sha256Hex } from '@/infra/crypto';
import {
  CollectionConnector,
  CollectionConnectorRequest,
  ConnectorResult,
  NormalizedCollectionStatus,
  ParsedWebhook,
} from './types';

type DarajaToken = { value: string; expiresAt: number };

export class SafaricomCollectionConnector implements CollectionConnector {
  readonly name = 'safaricom';
  readonly supportedMethods = ['mpesa'];

  private http: AxiosInstance;
  private token: DarajaToken | null = null;

  constructor() {
    this.http = axios.create({
      baseURL: config.safaricom.baseUrl,
      timeout: 15_000,
    });
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }
    const auth = Buffer.from(
      `${config.safaricom.consumerKey}:${config.safaricom.consumerSecret}`,
    ).toString('base64');
    const { data } = await this.http.get('/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` },
    });
    const expiresIn = Number((data as { expires_in: string | number }).expires_in ?? 3599);
    this.token = {
      value: (data as { access_token: string }).access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return this.token.value;
  }

  private buildStkPassword(): { password: string; timestamp: string } {
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const timestamp =
      now.getUTCFullYear().toString() +
      pad(now.getUTCMonth() + 1) +
      pad(now.getUTCDate()) +
      pad(now.getUTCHours()) +
      pad(now.getUTCMinutes()) +
      pad(now.getUTCSeconds());
    const password = Buffer.from(
      `${config.safaricom.shortcode}${config.safaricom.passkey}${timestamp}`,
    ).toString('base64');
    return { password, timestamp };
  }

  async initiateCollection(
    req: CollectionConnectorRequest,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    try {
      const token = await this.getToken();
      const { password, timestamp } = this.buildStkPassword();
      const normalizedPhone = req.customer.phone.replace(/^\+?/, '').replace(/^0/, '254');
      const body = {
        BusinessShortCode: config.safaricom.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(req.amount / 100), // Daraja expects whole KES
        PartyA: normalizedPhone,
        PartyB: config.safaricom.shortcode,
        PhoneNumber: normalizedPhone,
        CallBackURL: req.callback_url || config.safaricom.callbackUrl,
        AccountReference: req.reference.slice(0, 12),
        TransactionDesc: `Ogun ${req.collection_id}`,
      };
      const { data } = await this.http.post('/mpesa/stkpush/v1/processrequest', body, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const resp = data as {
        CheckoutRequestID?: string;
        MerchantRequestID?: string;
        ResponseCode?: string;
        ResponseDescription?: string;
      };
      const ok = resp.ResponseCode === '0';
      return {
        normalized_status: ok ? 'pending' : 'failed',
        provider_reference: resp.CheckoutRequestID ?? resp.MerchantRequestID ?? req.collection_id,
        raw_payload: resp as Record<string, unknown>,
        error_code: ok ? null : resp.ResponseCode ?? 'daraja_error',
        error_message: ok ? null : resp.ResponseDescription ?? 'STK push rejected',
        next_action: ok ? 'wait' : 'escalate',
      };
    } catch (err) {
      logger.error({ err }, 'safaricom initiateCollection failed');
      return {
        normalized_status: 'failed',
        provider_reference: req.collection_id,
        raw_payload: { error: (err as Error).message },
        error_code: 'provider_timeout',
        error_message: 'Safaricom Daraja request failed',
        next_action: 'escalate',
      };
    }
  }

  async getCollectionStatus(
    providerRef: string,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    try {
      const token = await this.getToken();
      const { password, timestamp } = this.buildStkPassword();
      const body = {
        BusinessShortCode: config.safaricom.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: providerRef,
      };
      const { data } = await this.http.post('/mpesa/stkpushquery/v1/query', body, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const resp = data as { ResultCode?: string; ResultDesc?: string };
      return this.mapStatusQueryResult(providerRef, resp);
    } catch (err) {
      logger.warn({ err, providerRef }, 'safaricom status query failed');
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

  private mapStatusQueryResult(
    providerRef: string,
    resp: { ResultCode?: string; ResultDesc?: string },
  ): ConnectorResult<NormalizedCollectionStatus> {
    const rc = resp.ResultCode;
    if (rc === '0') {
      return {
        normalized_status: 'succeeded',
        provider_reference: providerRef,
        raw_payload: resp as Record<string, unknown>,
        error_code: null,
        error_message: null,
        next_action: null,
      };
    }
    // 1032 = user cancelled; 1037 = timeout; 1 = insufficient funds
    const failing = ['1', '1032', '1037', '2001', '1019'];
    if (rc && failing.includes(rc)) {
      return {
        normalized_status: 'failed',
        provider_reference: providerRef,
        raw_payload: resp as Record<string, unknown>,
        error_code: rc,
        error_message: resp.ResultDesc ?? 'Safaricom failure',
        next_action: null,
      };
    }
    return {
      normalized_status: 'pending',
      provider_reference: providerRef,
      raw_payload: resp as Record<string, unknown>,
      error_code: null,
      error_message: null,
      next_action: 'poll',
    };
  }

  parseWebhook(payload: Buffer): ParsedWebhook {
    const outer = JSON.parse(payload.toString('utf8')) as {
      Body?: { stkCallback?: { CheckoutRequestID?: string; ResultCode?: number; ResultDesc?: string } };
    };
    const cb = outer.Body?.stkCallback;
    if (!cb) throw new Error('Invalid Safaricom callback payload');
    const rc = cb.ResultCode;
    let normalized: NormalizedCollectionStatus = 'pending';
    if (rc === 0) normalized = 'succeeded';
    else if (rc !== undefined && rc !== 0) normalized = 'failed';
    return {
      provider_reference: cb.CheckoutRequestID ?? '',
      normalized_status: normalized,
      failure_reason: rc === 0 ? undefined : cb.ResultDesc ?? 'failed',
      raw: outer as Record<string, unknown>,
    };
  }

  /**
   * Safaricom Daraja callbacks do not carry HMAC signatures. Production
   * deployments verify by (a) terminating TLS only on the registered
   * callback URL behind an IP allowlist, and (b) matching CheckoutRequestID
   * to an in-flight collection.  We return true here and enforce the above
   * at the infrastructure layer.
   */
  validateWebhookSignature(_payload: Buffer, _headers: Record<string, string>): boolean {
    return true;
  }

  static hashPayload(buf: Buffer): string {
    return sha256Hex(buf);
  }
}
