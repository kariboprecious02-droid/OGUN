/**
 * Demo / sandbox simulator (§9).
 *
 * Deterministic scenario routing based on the LAST THREE digits of the
 * customer phone number or beneficiary mobile:
 *
 *   001  → instant success (webhook)
 *   002  → customer timeout (expired after window)
 *   003  → success via poller (no webhook)
 *   004  → provider failure
 *   005  → poller-only success
 *   006  → duplicate webhook handling
 *   007  → 5-min TTL → timed_out (collections) / reversal (payouts)
 */

import { sha256Hex } from '@/infra/crypto';
import {
  CollectionConnector,
  CollectionConnectorRequest,
  ConnectorResult,
  NormalizedCollectionStatus,
  NormalizedPayoutStatus,
  ParsedWebhook,
  PayoutConnector,
  PayoutConnectorRequest,
} from './types';

function scenarioFromPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-3);
}

export class DemoCollectionConnector implements CollectionConnector {
  readonly name = 'demo';
  readonly supportedMethods = ['demo'];

  async initiateCollection(
    req: CollectionConnectorRequest,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    const scenario = scenarioFromPhone(req.customer.phone);
    const providerRef = `demo_${req.collection_id}`;
    switch (scenario) {
      case '001':
        return {
          normalized_status: 'succeeded',
          provider_reference: providerRef,
          raw_payload: { scenario },
          error_code: null,
          error_message: null,
          next_action: null,
        };
      case '004':
        return {
          normalized_status: 'failed',
          provider_reference: providerRef,
          raw_payload: { scenario, reason: 'provider_unavailable' },
          error_code: 'provider_unavailable',
          error_message: 'Simulated provider outage',
          next_action: null,
        };
      default:
        return {
          normalized_status: 'pending',
          provider_reference: providerRef,
          raw_payload: { scenario },
          error_code: null,
          error_message: null,
          next_action: 'wait',
        };
    }
  }

  async getCollectionStatus(
    providerRef: string,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    // In real usage the orchestrator tracks the originating phone in the
    // collection row and queries by provider_reference. For the demo we
    // simply return succeeded for any poll after initiation (scenario 003/005).
    return {
      normalized_status: 'succeeded',
      provider_reference: providerRef,
      raw_payload: { source: 'demo_poll' },
      error_code: null,
      error_message: null,
      next_action: null,
    };
  }

  parseWebhook(payload: Buffer): ParsedWebhook {
    const body = JSON.parse(payload.toString('utf8')) as {
      reference?: string;
      status?: string;
    };
    const s = body.status ?? 'pending';
    return {
      provider_reference: body.reference ?? '',
      normalized_status: (s as NormalizedCollectionStatus) ?? 'pending',
      raw: body as Record<string, unknown>,
    };
  }

  validateWebhookSignature(_payload: Buffer, _headers: Record<string, string>): boolean {
    return true;
  }

  static hashPayload(buf: Buffer): string {
    return sha256Hex(buf);
  }
}

export class DemoPayoutConnector implements PayoutConnector {
  readonly name = 'demo';
  readonly supportedMethods = ['demo', 'mobile_money', 'bank_transfer'];

  async initiatePayout(
    req: PayoutConnectorRequest,
  ): Promise<ConnectorResult<NormalizedPayoutStatus>> {
    const scenario = scenarioFromPhone(req.beneficiary.mobile_number ?? req.beneficiary.account_number ?? '');
    const providerRef = `demo_${req.payout_id}`;
    switch (scenario) {
      case '001':
        return {
          normalized_status: 'succeeded',
          provider_reference: providerRef,
          raw_payload: { scenario },
          error_code: null,
          error_message: null,
          next_action: null,
        };
      case '004':
        return {
          normalized_status: 'failed',
          provider_reference: providerRef,
          raw_payload: { scenario },
          error_code: 'provider_unavailable',
          error_message: 'Simulated payout failure',
          next_action: null,
        };
      case '007':
        return {
          normalized_status: 'succeeded',
          provider_reference: providerRef,
          raw_payload: { scenario, will_reverse: true },
          error_code: null,
          error_message: null,
          next_action: null,
        };
      default:
        return {
          normalized_status: 'processing',
          provider_reference: providerRef,
          raw_payload: { scenario },
          error_code: null,
          error_message: null,
          next_action: 'poll',
        };
    }
  }

  async getPayoutStatus(providerRef: string): Promise<ConnectorResult<NormalizedPayoutStatus>> {
    return {
      normalized_status: 'succeeded',
      provider_reference: providerRef,
      raw_payload: { source: 'demo_poll' },
      error_code: null,
      error_message: null,
      next_action: null,
    };
  }

  parseWebhook(payload: Buffer): ParsedWebhook {
    const body = JSON.parse(payload.toString('utf8')) as { reference?: string; status?: string };
    return {
      provider_reference: body.reference ?? '',
      normalized_status: (body.status as NormalizedPayoutStatus) ?? 'processing',
      raw: body as Record<string, unknown>,
    };
  }

  validateWebhookSignature(_payload: Buffer, _headers: Record<string, string>): boolean {
    return true;
  }
}
