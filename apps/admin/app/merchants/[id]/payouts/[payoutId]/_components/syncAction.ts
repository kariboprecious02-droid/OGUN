'use server';

import { syncPayoutAdmin, OgunApiError } from '@/lib/api';

export async function syncPayoutAction(
  payoutId: string,
): Promise<{ error: boolean; message: string }> {
  try {
    const result = await syncPayoutAdmin(payoutId);
    if (result.message) {
      return { error: false, message: result.message };
    }
    return {
      error: false,
      message: `Synced — status = ${result.status}` +
        (result.provider_status ? `, provider_status = ${result.provider_status}` : '') +
        (result.last_polled_at ? `, last polled at ${result.last_polled_at}` : ''),
    };
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 429) {
      return { error: true, message: 'Already synced within the last minute. Try again shortly.' };
    }
    if (err instanceof OgunApiError) {
      return { error: true, message: err.message };
    }
    return { error: true, message: 'Sync failed — unknown error' };
  }
}
