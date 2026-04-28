/**
 * Provider connector interface — Execution Spec §5.3.
 *
 * Every external PSP (Safaricom, Paystack, Demo) implements this interface.
 * Orchestrators NEVER call providers directly — they pick a connector, pass
 * a normalized request, and handle a normalized result.
 */

export type NormalizedCollectionStatus = 'pending' | 'processing' | 'succeeded' | 'failed';
export type NormalizedPayoutStatus =
  | 'created'
  | 'queued'
  | 'processing'
  | 'pending_approval'
  | 'pending_confirmation'
  | 'succeeded'
  | 'failed'
  | 'reversed'
  | 'cancelled';

export type CollectionConnectorRequest = {
  collection_id: string;
  amount: number; // cents (what customer pays)
  currency: string;
  method: 'mpesa' | 'airtel' | 'demo' | string;
  customer: { phone: string; name?: string; email?: string };
  reference: string;
  metadata?: Record<string, unknown>;
  callback_url: string;
};

export type PayoutConnectorRequest = {
  payout_id: string;
  amount: number; // cents recipient receives
  currency: string;
  method: 'mobile_money' | 'bank_transfer' | 'demo' | string;
  internal_method: string;
  beneficiary: {
    name: string;
    mobile_number?: string;
    bank_code?: string;
    account_number?: string;
    provider_recipient_code?: string;
  };
  reference: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type ConnectorResult<S extends string = string> = {
  normalized_status: S;
  provider_reference: string;
  raw_payload: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  next_action: 'wait' | 'poll' | 'retry' | 'escalate' | 'redirect' | null;
};

export type ParsedWebhook = {
  provider_reference: string;
  normalized_status: NormalizedCollectionStatus | NormalizedPayoutStatus;
  failure_reason?: string;
  raw: Record<string, unknown>;
};

export interface CollectionConnector {
  readonly name: string;
  readonly supportedMethods: string[];
  initiateCollection(
    req: CollectionConnectorRequest,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>>;
  getCollectionStatus(
    providerRef: string,
  ): Promise<ConnectorResult<NormalizedCollectionStatus>>;
  parseWebhook(payload: Buffer, headers: Record<string, string>): ParsedWebhook;
  validateWebhookSignature(payload: Buffer, headers: Record<string, string>): boolean;
}

export interface PayoutConnector {
  readonly name: string;
  readonly supportedMethods: string[];
  initiatePayout(req: PayoutConnectorRequest): Promise<ConnectorResult<NormalizedPayoutStatus>>;
  getPayoutStatus(providerRef: string): Promise<ConnectorResult<NormalizedPayoutStatus>>;
  parseWebhook(payload: Buffer, headers: Record<string, string>): ParsedWebhook;
  validateWebhookSignature(payload: Buffer, headers: Record<string, string>): boolean;
}
