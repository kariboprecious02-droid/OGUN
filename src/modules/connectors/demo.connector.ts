/**
 * Demo / sandbox simulator — Execution Spec §9.
 *
 * Deterministic scenario routing based on the LAST THREE digits of the
 * customer phone number or beneficiary mobile.  The full §9 scenario
 * set is:
 *
 *   001  → instant success (initiate returns succeeded)
 *   002  → customer timeout — initiate stays pending, poll returns
 *          failed with customer_timeout reason
 *   003  → success via poller — initiate stays pending, poll returns
 *          succeeded
 *   004  → provider failure — initiate returns failed
 *   005  → poller-only success — synonym of 003 but with no webhook
 *          path in the simulated provider
 *   006  → duplicate webhook — initiate stays pending, poll returns
 *          succeeded. The orchestrator's idempotent terminal handler
 *          guarantees the second webhook receipt is a no-op.
 *   007  → 5-minute TTL — initiate stays pending, poll stays pending,
 *          so the poller eventually times out and marks the collection
 *          as timed_out / failed. For payouts, 007 simulates a reversal
 *          (success then reversed).
 *
 * The scenario is encoded into the provider_reference as
 * `demo_<scenario>_<collection_id>` so subsequent status queries are
 * stateless and don't need to look up the collection.
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

function encodeProviderRef(scenario: string, id: string): string {
  return `demo_${scenario}_${id}`;
}

function decodeScenario(providerRef: string): string | null {
  const match = /^demo_(\d{3})_/.exec(providerRef);
  return match ? match[1] : null;
}

export class DemoCollectionConnector implements CollectionConnector {
  readonly name = 'demo';
  readonly supportedMethods = ['demo'];

  async initiateCollection(
    req: CollectionConnectorRequest,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>> {
    const scenario = scenarioFromPhone(req.customer.phone);
    const providerRef = encodeProviderRef(scenario, req.collection_id);
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
        // 002, 003, 005, 006, 007 and any unknown code stay pending here
        // and let the poller or webhook resolve them.
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
    const scenario = decodeScenario(providerRef) ?? '000';
    switch (scenario) {
      case '001':
      case '003':
      case '005':
      case '006':
        return {
          normalized_status: 'succeeded',
          provider_reference: providerRef,
          raw_payload: { scenario, source: 'demo_poll' },
          error_code: null,
          error_message: null,
          next_action: null,
        };
      case '002':
        return {
          normalized_status: 'failed',
          provider_reference: providerRef,
          raw_payload: { scenario, source: 'demo_poll', reason: 'customer_timeout' },
          error_code: 'customer_timeout',
          error_message: 'Customer did not complete the payment',
          next_action: null,
        };
      case '004':
        return {
          normalized_status: 'failed',
          provider_reference: providerRef,
          raw_payload: { scenario, source: 'demo_poll', reason: 'provider_unavailable' },
          error_code: 'provider_unavailable',
          error_message: 'Simulated provider outage',
          next_action: null,
        };
      case '007':
        // Stay pending so the poller exhausts its TTL and the
        // orchestrator times out → business_status=failed.
        return {
          normalized_status: 'pending',
          provider_reference: providerRef,
          raw_payload: { scenario, source: 'demo_poll' },
          error_code: null,
          error_message: null,
          next_action: 'poll',
        };
      default:
        // Unknown scenarios resolve succeeded for backwards compatibility.
        return {
          normalized_status: 'succeeded',
          provider_reference: providerRef,
          raw_payload: { scenario, source: 'demo_poll' },
          error_code: null,
          error_message: null,
          next_action: null,
        };
    }
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
    const scenario = scenarioFromPhone(
      req.beneficiary.mobile_number ?? req.beneficiary.account_number ?? '',
    );
    const providerRef = encodeProviderRef(scenario, req.payout_id);
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
        // Demo reversal scenario — succeeds immediately, then a
        // separate reversal event flips status → reversed.  The
        // orchestrator handles the reversal path through resolvePayout.
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
    const scenario = decodeScenario(providerRef) ?? '000';
    switch (scenario) {
      case '001':
      case '003':
      case '005':
      case '006':
        return {
          normalized_status: 'succeeded',
          provider_reference: providerRef,
          raw_payload: { scenario, source: 'demo_poll' },
          error_code: null,
          error_message: null,
          next_action: null,
        };
      case '002':
      case '004':
        return {
          normalized_status: 'failed',
          provider_reference: providerRef,
          raw_payload: { scenario, source: 'demo_poll' },
          error_code: 'provider_unavailable',
          error_message: 'Simulated payout failure',
          next_action: null,
        };
      default:
        return {
          normalized_status: 'succeeded',
          provider_reference: providerRef,
          raw_payload: { scenario, source: 'demo_poll' },
          error_code: null,
          error_message: null,
          next_action: null,
        };
    }
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
