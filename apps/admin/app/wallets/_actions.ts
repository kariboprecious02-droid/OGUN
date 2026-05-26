'use server';

import { fundWallet, freezeWallet, unfreezeWallet, OgunApiError } from '@/lib/api';

export async function fundWalletAction(body: {
  wallet_id: string;
  amount: number;
  currency: string;
  source: 'bank_transfer' | 'paybill_transfer';
  source_reference: string | null;
  reason: string;
}): Promise<{ error: boolean; message: string; data?: Record<string, unknown> }> {
  try {
    const result = await fundWallet(body);
    return {
      error: false,
      message: `Credited KES ${(result.amount / 100).toLocaleString()} — attributed to ${result.initiated_by}`,
      data: result as unknown as Record<string, unknown>,
    };
  } catch (err) {
    if (err instanceof OgunApiError) {
      return { error: true, message: err.message };
    }
    return { error: true, message: 'Funding failed — unknown error' };
  }
}

export async function freezeWalletAction(
  walletId: string,
  reason: string,
): Promise<{ error: boolean; message: string }> {
  try {
    await freezeWallet(walletId, reason);
    return { error: false, message: 'Wallet frozen' };
  } catch (err) {
    if (err instanceof OgunApiError) return { error: true, message: err.message };
    return { error: true, message: 'Failed to freeze wallet' };
  }
}

export async function unfreezeWalletAction(
  walletId: string,
): Promise<{ error: boolean; message: string }> {
  try {
    await unfreezeWallet(walletId);
    return { error: false, message: 'Wallet unfrozen' };
  } catch (err) {
    if (err instanceof OgunApiError) return { error: true, message: err.message };
    return { error: true, message: 'Failed to unfreeze wallet' };
  }
}
