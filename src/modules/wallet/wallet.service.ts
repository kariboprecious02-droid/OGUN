import type { PoolClient } from 'pg';
import { newId } from '@/infra/ids';
import { withTransaction } from '@/infra/db/pool';
import { OgunError } from '@/infra/errors';
import {
  insertWallet,
  findWalletBySub,
  listWalletsByMerchant,
  lockWalletForUpdate,
} from './wallet.repository';
import { postLedgerEntry } from './ledger';
import { LedgerTxType, WalletType } from './wallet.types';

export async function createWalletsForSubMerchant(
  client: PoolClient,
  merchantId: string,
  subMerchantId: string,
  currency = 'KES',
): Promise<void> {
  await insertWallet(client, {
    id: newId('wallet'),
    merchant_id: merchantId,
    sub_merchant_id: subMerchantId,
    wallet_type: 'collection',
    currency,
  });
  await insertWallet(client, {
    id: newId('wallet'),
    merchant_id: merchantId,
    sub_merchant_id: subMerchantId,
    wallet_type: 'payout',
    currency,
  });
}

export async function getWallet(
  subMerchantId: string,
  walletType: WalletType,
  currency = 'KES',
): Promise<ReturnType<typeof findWalletBySub>> {
  const w = await findWalletBySub(subMerchantId, walletType, currency);
  if (!w) throw OgunError.notFound(`${walletType} wallet for ${subMerchantId}`);
  return w;
}

export async function listWallets(merchantId: string) {
  return listWalletsByMerchant(merchantId);
}

/**
 * Top-up a payout wallet (§12.5).
 */
export async function topupPayoutWallet(input: {
  merchantId: string;
  subMerchantId: string;
  amount: number;
  currency?: string;
  reference: string;
  idempotencyKey: string;
}): Promise<{ wallet_id: string; available_balance: number }> {
  const currency = input.currency ?? 'KES';
  return withTransaction(async (client) => {
    const wallet = await findWalletBySub(input.subMerchantId, 'payout', currency);
    if (!wallet) throw OgunError.notFound('payout wallet', input.subMerchantId);
    await lockWalletForUpdate(client, wallet.id);
    await postLedgerEntry(client, {
      merchantId: input.merchantId,
      subMerchantId: input.subMerchantId,
      walletId: wallet.id,
      walletType: 'payout',
      transactionType: LedgerTxType.PayoutWalletTopupCredit,
      direction: 'credit',
      amount: input.amount,
      currency,
      referenceType: 'topup',
      referenceId: input.reference,
      idempotencyKey: input.idempotencyKey,
      description: `Topup ${input.reference}`,
    });
    const refreshed = await lockWalletForUpdate(client, wallet.id);
    return { wallet_id: wallet.id, available_balance: refreshed.available_balance };
  });
}
