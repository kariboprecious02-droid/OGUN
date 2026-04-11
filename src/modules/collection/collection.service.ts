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
  method: 'mpesa' | 'airtel' | 'demo';
  customer: { phone: string; name?: string; email?: string };
  reference?: string;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
};

export type CreateCollectionResult = {
  collection: CollectionRow;
  business_status: CollectionBusinessStatusValue;
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

  // Dispatch to provider asynchronously (but in-line for MVP simplicity).
  // Production: this is offloaded to a BullMQ job via the outbox pattern.
  void dispatchToProvider(row.id).catch((err) =>
    logger.error({ err, collection_id: row.id }, 'provider dispatch failed'),
  );

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
      business_status: row.business_status,
      reference: row.merchant_reference,
    },
  });

  return { collection: row, business_status: row.business_status };
}

async function dispatchToProvider(collectionId: string): Promise<void> {
  const row = await findCollection(collectionId);
  if (!row) return;
  const connector = getCollectionConnector(row.provider);
  const result = await connector.initiateCollection({
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

  await withTransaction(async (client) => {
    const locked = await lockCollection(client, row.id);
    if (isTerminal(locked.internal_status)) return;

    // Dispatch NEVER writes a terminal status directly — terminal state
    // flows exclusively through resolveCollection so the wallet-crediting
    // path is the single source of truth. Here we only record that the
    // provider accepted (or visibly rejected) the submission.
    const nextInternal: CollectionInternalStatusValue =
      CollectionInternalStatus.PendingCustomerAction;
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
      details: { provider_reference: result.provider_reference, error_code: result.error_code },
    });
  });

  // Start polling (will stop early if terminal). Safe to call even on instant
  // success because enqueuePollingJob is idempotent.
  if (result.next_action !== null) {
    await enqueuePollingJob({
      referenceType: 'collection',
      referenceId: row.id,
      providerReference: result.provider_reference,
      provider: row.provider,
    });
  }

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
      failureReason: result.error_code ?? 'provider_rejected',
    });
  }
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

export { findCollectionByProviderRef };
