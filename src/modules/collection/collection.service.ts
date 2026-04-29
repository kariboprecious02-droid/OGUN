/**
 * Collection Orchestrator — Execution Spec §5.5.
 *
 * Lifecycle:
 *   1. POST /v1/collections validates, snapshots fees, persists.
 *   2. Connector dispatch (Safaricom / Paystack / Demo).
 *   3. 5s poller kick-off (5-min TTL).
 *   4. Webhook or poller resolves → idempotent terminal-state handler.
 *   5. On success: wallet credit + fee debit + settlement_eligible=true.
 *   6. On failure/timeout: wallet untouched, business_status=failed.
 */

import { withTransaction } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { OgunError } from '@/infra/errors';
import { logger } from '@/infra/logger';
import { config } from '@/infra/config';
import {
  getMerchant,
  getSubMerchant,
} from '@/modules/merchant/merchant.service';
import { MerchantStatus } from '@/modules/merchant/merchant.types';
import { resolveEffectiveSettings } from '@/modules/merchant/settings.repository';
import { computeCollectionFee } from './fees';
import {
  insertCollection,
  findCollection,
  findCollectionByProviderRef,
  insertCollectionAudit,
  lockCollection,
  updateCollectionStatus,
  listCollections as listCollectionsRepo,
} from './collection.repository';
import {
  CollectionRow,
  CollectionBusinessStatus,
  CollectionBusinessStatusValue,
  CollectionInternalStatus,
  CollectionInternalStatusValue,
  toBusinessStatus,
  isTerminal,
} from './collection.types';
import { pickCollectionProvider, getCollectionConnector } from '@/modules/connectors/registry';
import { recordCollectionEvent } from '@/modules/observability/collectionEvents';
import { setContextField } from '@/infra/requestContext';
import { findWalletBySub, lockWalletForUpdate } from '@/modules/wallet/wallet.repository';
import { postLedgerEntry } from '@/modules/wallet/ledger';
import { LedgerTxType } from '@/modules/wallet/wallet.types';
import { enqueuePollingJob } from '@/modules/polling/polling.service';
import { emitEvent } from '@/modules/webhook/webhook.service';


export type CreateCollectionInput = {
  merchant_id: string;
  sub_merchant_id: string;
  amount: number;
  currency: string;
  method: 'mpesa' | 'airtel' | 'till' | 'card' | 'bank' | 'demo';
  customer: { phone: string; name?: string; email?: string };
  reference?: string;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
};

export type CreateCollectionResult = {
  collection: CollectionRow;
  business_status: CollectionBusinessStatusValue;
  provider_call_state: 'completed' | 'timed_out' | 'error' | null;
  next_action: string | null;
  provider_message: string | null;
  failure_reason: string | null;
};

export async function createCollection(
  input: CreateCollectionInput,
): Promise<CreateCollectionResult> {
  const merchant = await getMerchant(input.merchant_id);
  if (merchant.status !== MerchantStatus.Active) {
    throw OgunError.merchantNotActive(merchant.id);
  }
  const sub = await getSubMerchant(input.sub_merchant_id);
  if (sub.merchant_id !== merchant.id) {
    throw OgunError.invalidRequest('sub_merchant_id does not belong to merchant_id');
  }
  if (sub.status !== 'active') {
    throw OgunError.subMerchantNotActive(sub.id);
  }

  const settings = await resolveEffectiveSettings(merchant.id, sub.id);
  if (!settings.enabled_methods.includes(input.method) && input.method !== 'demo') {
    throw OgunError.methodNotEnabled(input.method);
  }

  const feeSnapshot = computeCollectionFee(
    input.amount,
    settings.collection_fee_pct,
    settings.collection_fee_model,
    input.currency,
  );

  const { provider } = pickCollectionProvider(input.method);

  const row = await insertCollection({
    id: newId('collection'),
    merchant_id: merchant.id,
    sub_merchant_id: sub.id,
    amount: feeSnapshot.amount,
    fee_amount: feeSnapshot.fee_amount,
    customer_amount: feeSnapshot.customer_amount,
    currency: input.currency,
    method: input.method,
    provider,
    merchant_reference: input.reference ?? null,
    customer_name: input.customer.name ?? null,
    customer_phone: input.customer.phone,
    customer_email: input.customer.email ?? null,
    fee_snapshot: feeSnapshot as unknown as Record<string, unknown>,
    metadata: input.metadata ?? null,
    idempotency_key: input.idempotency_key ?? null,
  });

  setContextField('collection_id', row.id);

  recordCollectionEvent({
    collection_id: row.id,
    event_type: 'api.received',
    source: 'api',
    payload: { amount: input.amount, method: input.method, currency: input.currency },
    message: `POST /v1/collections received for ${input.method}`,
  });

  recordCollectionEvent({
    collection_id: row.id,
    event_type: 'api.validated',
    source: 'api',
    payload: { merchant_id: merchant.id, sub_merchant_id: sub.id, fee_model: feeSnapshot.model },
    message: 'request validated, fees computed',
  });

  recordCollectionEvent({
    collection_id: row.id,
    event_type: 'db.created',
    source: 'orchestrator',
    payload: { id: row.id, provider, business_status: row.business_status },
    message: `collection row created, provider=${provider}`,
  });

  const dispatchResult = await dispatchToProviderSync(row);

  await emitEvent({
    merchantId: merchant.id,
    type: 'collection.created',
    data: {
      collection_id: row.id,
      merchant_id: merchant.id,
      sub_merchant_id: sub.id,
      amount: row.amount,
      currency: row.currency,
      method: row.method,
      business_status: dispatchResult.business_status,
      reference: row.merchant_reference,
    },
  });

  const updated = await findCollection(row.id);
  return {
    collection: updated ?? row,
    business_status: dispatchResult.business_status,
    provider_call_state: dispatchResult.provider_call_state,
    next_action: dispatchResult.next_action,
    provider_message: dispatchResult.provider_message,
    failure_reason: dispatchResult.failure_reason,
  };
}

type DispatchResult = {
  business_status: CollectionBusinessStatusValue;
  provider_call_state: 'completed' | 'timed_out' | 'error';
  next_action: string | null;
  provider_message: string | null;
  failure_reason: string | null;
};

function mapNextAction(connectorAction: string | null, normalizedStatus: string): string | null {
  if (normalizedStatus === 'failed') return null;
  if (connectorAction === 'redirect') return 'redirect';
  if (connectorAction === 'wait') return 'otp_required';
  return connectorAction;
}

async function dispatchToProviderSync(row: CollectionRow): Promise<DispatchResult> {
  const connector = getCollectionConnector(row.provider);
  const dispatchStart = Date.now();

  logger.info({ collection_id: row.id, provider: row.provider, method: row.method },
    'dispatching to provider');

  let result;
  try {
    result = await connector.initiateCollection({
      collection_id: row.id,
      amount: row.customer_amount,
      currency: row.currency,
      method: row.method,
      customer: {
        phone: row.customer_phone,
        name: row.customer_name ?? undefined,
        email: row.customer_email ?? undefined,
      },
      reference: row.merchant_reference ?? row.id,
      metadata: row.metadata ?? undefined,
      callback_url: `${config.baseUrls.api}/webhooks/${row.provider}`,
    });
  } catch (err) {
    const latencyMs = Date.now() - dispatchStart;
    logger.error({ err, collection_id: row.id, latency_ms: latencyMs },
      'provider dispatch timed out or errored');

    recordCollectionEvent({
      collection_id: row.id,
      event_type: 'provider.timed_out',
      source: 'orchestrator',
      latency_ms: latencyMs,
      payload: { next_action: null, err_message: (err as Error).message },
      message: `provider dispatch threw after ${latencyMs}ms (catastrophic — connector inner catch did not handle)`,
    });

    await enqueuePollingJob({
      referenceType: 'collection',
      referenceId: row.id,
      providerReference: null,
      provider: row.provider,
    });

    recordCollectionEvent({
      collection_id: row.id,
      event_type: 'polling.enqueued',
      source: 'orchestrator',
      payload: { reason: 'catastrophic_throw', provider_reference: null },
      message: 'polling enqueued after catastrophic throw — TTL will resolve to failed',
    });

    return {
      business_status: CollectionBusinessStatus.Pending,
      provider_call_state: 'timed_out',
      next_action: null,
      provider_message: null,
      failure_reason: null,
    };
  }

  const dispatchLatencyMs = Date.now() - dispatchStart;
  logger.info({
    collection_id: row.id,
    provider: row.provider,
    normalized_status: result.normalized_status,
    provider_reference: result.provider_reference,
    latency_ms: dispatchLatencyMs,
  }, 'provider dispatch returned');

  await withTransaction(async (client) => {
    const locked = await lockCollection(client, row.id);
    if (isTerminal(locked.internal_status)) return;

    const nextInternal: CollectionInternalStatusValue =
      result.normalized_status === 'failed'
        ? CollectionInternalStatus.Failed
        : CollectionInternalStatus.PendingCustomerAction;
    const nextBusiness = toBusinessStatus(nextInternal);
    const submissionAt = new Date();

    await updateCollectionStatus(client, row.id, {
      internal_status: nextInternal,
      business_status: nextBusiness,
      provider_reference: result.provider_reference,
      provider_submission_at: submissionAt,
      status_reason: result.error_code ?? null,
    });

    await insertCollectionAudit(client, {
      collection_id: row.id,
      event_source: 'api',
      event_type: 'provider_submission',
      previous_internal_status: row.internal_status,
      new_internal_status: nextInternal,
      previous_business_status: row.business_status,
      new_business_status: nextBusiness,
      details: {
        provider_reference: result.provider_reference,
        error_code: result.error_code,
        normalized_status: result.normalized_status,
      },
    });

    recordCollectionEvent({
      collection_id: row.id,
      event_type: 'state.changed',
      source: 'orchestrator',
      latency_ms: dispatchLatencyMs,
      payload: {
        from: row.internal_status,
        to: nextInternal,
        provider_reference: result.provider_reference,
        normalized_status: result.normalized_status,
      },
      message: `${row.internal_status} → ${nextInternal}`,
    });
  });

  const shouldPoll = result.next_action !== null && result.normalized_status !== 'failed';
  if (shouldPoll) {
    await enqueuePollingJob({
      referenceType: 'collection',
      referenceId: row.id,
      providerReference: result.provider_reference,
      provider: row.provider,
    });

    recordCollectionEvent({
      collection_id: row.id,
      event_type: 'polling.enqueued',
      source: 'orchestrator',
      payload: { provider_reference: result.provider_reference, provider: row.provider },
      message: 'polling job enqueued',
    });
  }

  if (result.normalized_status === 'succeeded') {
    await resolveCollection(row.id, {
      source: 'api',
      normalizedStatus: 'succeeded',
      providerReference: result.provider_reference,
    });
    return {
      business_status: CollectionBusinessStatus.Successful,
      provider_call_state: 'completed',
      next_action: null,
      provider_message: null,
      failure_reason: null,
    };
  }

  if (result.normalized_status === 'failed') {
    await resolveCollection(row.id, {
      source: 'api',
      normalizedStatus: 'failed',
      providerReference: result.provider_reference,
      failureReason: result.error_code ?? 'provider_rejected',
    });
    return {
      business_status: CollectionBusinessStatus.Failed,
      provider_call_state: 'completed',
      next_action: null,
      provider_message: result.error_message,
      failure_reason: result.error_code ?? 'provider_rejected',
    };
  }

  return {
    business_status: CollectionBusinessStatus.Pending,
    provider_call_state: 'completed',
    next_action: mapNextAction(result.next_action, result.normalized_status),
    provider_message: result.error_message,
    failure_reason: null,
  };
}

/**
 * Terminal-state handler. Idempotent: if the collection is already terminal,
 * subsequent calls are no-ops (§10.1 duplicate webhook handling).
 */
export async function resolveCollection(
  collectionId: string,
  input: {
    source: 'webhook' | 'poller' | 'api' | 'admin';
    normalizedStatus: 'succeeded' | 'failed';
    providerReference?: string;
    failureReason?: string;
    payloadHash?: string;
  },
): Promise<CollectionRow> {
  return withTransaction(async (client) => {
    const row = await lockCollection(client, collectionId);
    if (isTerminal(row.internal_status)) {
      // Already resolved — no-op
      await insertCollectionAudit(client, {
        collection_id: row.id,
        event_source: input.source,
        event_type: 'duplicate_resolution_no_op',
        previous_internal_status: row.internal_status,
        new_internal_status: row.internal_status,
        provider_payload_hash: input.payloadHash ?? null,
      });
      return row;
    }

    const nextInternal: CollectionInternalStatusValue =
      input.normalizedStatus === 'succeeded'
        ? CollectionInternalStatus.Succeeded
        : CollectionInternalStatus.Failed;
    const nextBusiness = toBusinessStatus(nextInternal);
    const resolvedAt = new Date();

    const patch: Parameters<typeof updateCollectionStatus>[2] = {
      internal_status: nextInternal,
      business_status: nextBusiness,
      status_reason: input.failureReason ?? null,
      final_resolved_at: resolvedAt,
      polling_stopped_at: resolvedAt,
      polling_stop_reason: input.normalizedStatus,
    };
    if (input.providerReference) patch.provider_reference = input.providerReference;
    if (input.source === 'webhook') {
      patch.webhook_received_at = row.webhook_received_at ?? resolvedAt;
      patch.last_webhook_at = resolvedAt;
    }

    if (input.normalizedStatus === 'succeeded') {
      // Credit the collection wallet in the SAME transaction.
      const wallet = await findWalletBySub(row.sub_merchant_id, 'collection', row.currency);
      if (!wallet) throw new Error(`No collection wallet for ${row.sub_merchant_id}`);
      await lockWalletForUpdate(client, wallet.id);

      const snapshot = row.fee_snapshot as {
        model: 'merchant_covers' | 'payer_covers';
        wallet_credit: number;
        fee_amount: number;
      };
      const feeModel = snapshot.model;
      const feeAmount = snapshot.fee_amount;

      // In BOTH fee models the collection_credit entry records the full
      // principal `row.amount`. For merchant_covers we then post a
      // separate collection_fee_debit so the wallet nets to (amount - fee).
      // For payer_covers, the customer already paid (amount + fee) — the
      // platform's fee is not in the merchant wallet at all, so we skip
      // the debit entirely.
      await postLedgerEntry(client, {
        merchantId: row.merchant_id,
        subMerchantId: row.sub_merchant_id,
        walletId: wallet.id,
        walletType: 'collection',
        transactionType: LedgerTxType.CollectionCredit,
        direction: 'credit',
        amount: row.amount,
        currency: row.currency,
        referenceType: 'collection',
        referenceId: row.id,
        idempotencyKey: `collection_credit:${row.id}`,
        description: `Collection ${row.id}`,
      });

      if (feeModel === 'merchant_covers' && feeAmount > 0) {
        await postLedgerEntry(client, {
          merchantId: row.merchant_id,
          subMerchantId: row.sub_merchant_id,
          walletId: wallet.id,
          walletType: 'collection',
          transactionType: LedgerTxType.CollectionFeeDebit,
          direction: 'debit',
          amount: feeAmount,
          currency: row.currency,
          referenceType: 'collection',
          referenceId: row.id,
          idempotencyKey: `collection_fee_debit:${row.id}`,
          description: `Collection fee ${row.id}`,
        });
      }

      patch.settlement_eligible = true;
      patch.settlement_eligible_at = resolvedAt;
      patch.wallet_credited = true;
      patch.wallet_credited_at = resolvedAt;
    }

    await updateCollectionStatus(client, row.id, patch);

    await insertCollectionAudit(client, {
      collection_id: row.id,
      event_source: input.source,
      event_type: 'status_transition',
      previous_internal_status: row.internal_status,
      new_internal_status: nextInternal,
      previous_business_status: row.business_status,
      new_business_status: nextBusiness,
      provider_payload_hash: input.payloadHash ?? null,
      details: { failure_reason: input.failureReason },
    });

    recordCollectionEvent({
      collection_id: row.id,
      event_type: 'state.changed',
      source: input.source === 'webhook' ? 'webhook' : input.source === 'poller' ? 'poller' : 'orchestrator',
      payload: {
        from: row.internal_status,
        to: nextInternal,
        source: input.source,
        failure_reason: input.failureReason,
      },
      message: `${row.internal_status} → ${nextInternal} (via ${input.source})`,
    });

    return { ...row, ...patch } as CollectionRow;
  }).then(async (updated) => {
    if (updated.business_status === CollectionBusinessStatus.Successful) {
      await emitEvent({
        merchantId: updated.merchant_id,
        type: 'collection.succeeded',
        data: {
          collection_id: updated.id,
          merchant_id: updated.merchant_id,
          sub_merchant_id: updated.sub_merchant_id,
          amount: updated.amount,
          currency: updated.currency,
          business_status: 'successful',
          provider_reference: updated.provider_reference,
          reference: updated.merchant_reference,
        },
      });
    } else if (updated.business_status === CollectionBusinessStatus.Failed) {
      await emitEvent({
        merchantId: updated.merchant_id,
        type: 'collection.failed',
        data: {
          collection_id: updated.id,
          merchant_id: updated.merchant_id,
          sub_merchant_id: updated.sub_merchant_id,
          amount: updated.amount,
          currency: updated.currency,
          business_status: 'failed',
          failure_reason: updated.status_reason ?? 'unknown',
          reference: updated.merchant_reference,
        },
      });
    }
    return updated;
  });
}

/** 5-min TTL expired — mark timed_out, business_status=failed (§5.4). */
export async function timeoutCollection(collectionId: string): Promise<void> {
  return withTransaction(async (client) => {
    const row = await lockCollection(client, collectionId);
    if (isTerminal(row.internal_status)) return;
    const now = new Date();
    await updateCollectionStatus(client, row.id, {
      internal_status: CollectionInternalStatus.TimedOut,
      business_status: CollectionBusinessStatus.Failed,
      status_reason: 'collection_timed_out',
      final_resolved_at: now,
      polling_stopped_at: now,
      polling_stop_reason: 'timeout',
      settlement_eligible: false,
      wallet_credited: false,
    });
    await insertCollectionAudit(client, {
      collection_id: row.id,
      event_source: 'poller',
      event_type: 'timeout_triggered',
      previous_internal_status: row.internal_status,
      new_internal_status: CollectionInternalStatus.TimedOut,
      previous_business_status: row.business_status,
      new_business_status: CollectionBusinessStatus.Failed,
    });
  }).then(async () => {
    const updated = await findCollection(collectionId);
    if (!updated) return;
    await emitEvent({
      merchantId: updated.merchant_id,
      type: 'collection.failed',
      data: {
        collection_id: updated.id,
        merchant_id: updated.merchant_id,
        sub_merchant_id: updated.sub_merchant_id,
        amount: updated.amount,
        currency: updated.currency,
        business_status: 'failed',
        failure_reason: 'collection_timed_out',
        reference: updated.merchant_reference,
      },
    });
  });
}

export async function getCollection(id: string): Promise<CollectionRow> {
  const row = await findCollection(id);
  if (!row) throw OgunError.notFound('Collection', id);
  return row;
}

export async function listCollections(params: Parameters<typeof listCollectionsRepo>[0]) {
  return listCollectionsRepo(params);
}

/**
 * Refund a successful collection (§5.8).
 *
 * Rules:
 *   - Only collections with business_status='successful' can be refunded.
 *   - Refund amount must be 0 < amount <= (collection.amount - refunded_amount).
 *   - If the collection is NOT yet in a settlement batch: remove it from
 *     settlement eligibility (no settlement_batch_id yet, flip
 *     settlement_eligible false) and debit the collection wallet directly
 *     so the ledger reflects the refund immediately.
 *   - If the collection IS already settled: record a
 *     refund_adjustment_debit ledger entry that the next settlement cycle
 *     will net against gross. The original settlement row is NOT touched.
 *
 * Partial refunds are supported and mark refund_status='partial_refund'.
 * A full refund flips business_status='refunded'.
 */
export async function refundCollection(input: {
  collection_id: string;
  amount: number;
  reference?: string;
  reason?: string;
}): Promise<CollectionRow> {
  const updated = await withTransaction(async (client) => {
    const row = await lockCollection(client, input.collection_id);
    if (row.business_status !== 'successful') {
      throw OgunError.invalidRequest(
        `Only successful collections can be refunded (current: ${row.business_status})`,
      );
    }
    const alreadyRefunded = row.refunded_amount ?? 0;
    const available = row.amount - alreadyRefunded;
    if (input.amount <= 0 || input.amount > available) {
      throw OgunError.invalidRequest(
        `Refund amount must be 0 < amount <= ${available} (remaining refundable)`,
      );
    }

    const wallet = await findWalletBySub(row.sub_merchant_id, 'collection', row.currency);
    if (!wallet) throw new Error(`No collection wallet for ${row.sub_merchant_id}`);
    await lockWalletForUpdate(client, wallet.id);

    // Decide path: already-settled vs still-eligible
    const alreadySettled = row.settlement_batch_id !== null;
    const refundRef = input.reference ?? `refund:${row.id}:${Date.now()}`;

    if (alreadySettled) {
      // Record an adjustment against the *next* settlement cycle.
      await postLedgerEntry(client, {
        merchantId: row.merchant_id,
        subMerchantId: row.sub_merchant_id,
        walletId: wallet.id,
        walletType: 'collection',
        transactionType: LedgerTxType.RefundAdjustmentDebit,
        direction: 'debit',
        amount: input.amount,
        currency: row.currency,
        referenceType: 'refund',
        referenceId: row.id,
        idempotencyKey: `refund_adjustment:${row.id}:${alreadyRefunded + input.amount}`,
        description: input.reason ?? `Refund adjustment for ${row.id}`,
      });
    } else {
      // Not yet settled — revoke settlement eligibility and debit the
      // wallet directly so the wallet balance reflects the refund today.
      // We post a manual adjustment entry tagged to the refund reference.
      await postLedgerEntry(client, {
        merchantId: row.merchant_id,
        subMerchantId: row.sub_merchant_id,
        walletId: wallet.id,
        walletType: 'collection',
        transactionType: LedgerTxType.ManualAdjustment,
        direction: 'debit',
        amount: input.amount,
        currency: row.currency,
        referenceType: 'refund',
        referenceId: row.id,
        idempotencyKey: `refund_revoke:${row.id}:${alreadyRefunded + input.amount}`,
        description: input.reason ?? `Pre-settlement refund for ${row.id}`,
      });
    }

    const totalRefunded = alreadyRefunded + input.amount;
    const isFull = totalRefunded >= row.amount;
    const nowTs = new Date();

    await updateCollectionStatus(client, row.id, {
      refund_status: isFull ? 'refunded' : 'partial_refund',
      refunded_amount: totalRefunded,
      refund_timestamp: nowTs,
      refund_reference: refundRef,
      // If the full amount is refunded and the collection is not yet
      // settled, flip it out of settlement eligibility. Already-settled
      // collections keep business_status=refunded with settlement
      // adjustment applied next cycle.
      ...(isFull
        ? {
            business_status: 'refunded' as const,
            internal_status: 'refunded' as CollectionInternalStatusValue,
            settlement_eligible: alreadySettled ? row.settlement_eligible : false,
          }
        : {}),
    });

    await insertCollectionAudit(client, {
      collection_id: row.id,
      event_source: 'refund',
      event_type: 'refund_posted',
      previous_business_status: row.business_status,
      new_business_status: isFull ? 'refunded' : row.business_status,
      previous_internal_status: row.internal_status,
      new_internal_status: isFull ? 'refunded' : row.internal_status,
      details: {
        refund_amount: input.amount,
        total_refunded: totalRefunded,
        already_settled: alreadySettled,
        reference: refundRef,
      },
    });

    return { ...row, refunded_amount: totalRefunded } as CollectionRow;
  });

  // Emit webhook for full refunds only — partial refunds are also worth
  // an event, but we keep the emitted types aligned to §8.1 which lists
  // only collection.refunded.
  const finalRow = await findCollection(input.collection_id);
  if (finalRow && finalRow.business_status === 'refunded') {
    await emitEvent({
      merchantId: finalRow.merchant_id,
      type: 'collection.refunded',
      data: {
        collection_id: finalRow.id,
        merchant_id: finalRow.merchant_id,
        sub_merchant_id: finalRow.sub_merchant_id,
        amount: finalRow.amount,
        business_status: 'refunded',
        refund_amount: finalRow.refunded_amount,
        reference: finalRow.merchant_reference,
      },
    });
  }
  return finalRow ?? updated;
}

/**
 * Force a provider status query (§12.3). Rate-limited at the route layer
 * (1 call per collection per minute).  If the collection is already
 * terminal, returns the current row without calling the provider.
 * Otherwise calls the connector and, if the result is conclusive,
 * resolves the collection through the same idempotent terminal handler
 * the webhook + poller use.
 */
export async function syncCollection(id: string): Promise<CollectionRow> {
  const row = await getCollection(id);
  if (isTerminal(row.internal_status)) return row;
  if (!row.provider_reference) return row;

  const connector = getCollectionConnector(row.provider);
  const result = await connector.getCollectionStatus(row.provider_reference);

  if (result.normalized_status === 'succeeded') {
    await resolveCollection(row.id, {
      source: 'api',
      normalizedStatus: 'succeeded',
      providerReference: result.provider_reference,
    });
  } else if (result.normalized_status === 'failed') {
    await resolveCollection(row.id, {
      source: 'api',
      normalizedStatus: 'failed',
      providerReference: result.provider_reference,
      failureReason: result.error_code ?? 'sync_reported_failure',
    });
  }
  return getCollection(id);
}

export { findCollectionByProviderRef };
