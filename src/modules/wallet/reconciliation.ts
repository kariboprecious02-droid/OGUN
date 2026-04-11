/**
 * Ledger reconciliation worker — Execution Spec §3.5 / §13.4.
 *
 * Verifies the wallet invariant:
 *
 *   available_balance = Σ posted (non-reserved) ledger entries
 *   reserved_balance  = Σ payout_reserve − payout_release − payout_*_debit
 *
 * For each wallet we compare the stored column values against the
 * derived sum from the ledger entries. Any drift is recorded in a new
 * `ledger_drift_events` table and logged at ERROR so ops can page.
 *
 * Runs hourly via BullMQ when OGUN_WORKERS=1, or on-demand via
 * `reconcileAllWallets()` for manual runs and tests.
 */

import { query } from '@/infra/db/pool';
import { logger } from '@/infra/logger';
import { newId } from '@/infra/ids';
import { deriveWalletBalance } from './ledger';

export type WalletDriftRow = {
  wallet_id: string;
  sub_merchant_id: string;
  wallet_type: 'collection' | 'payout';
  stored_available: number;
  derived_available: number;
  stored_reserved: number;
  derived_reserved: number;
  available_delta: number;
  reserved_delta: number;
};

export type ReconciliationReport = {
  total_wallets: number;
  wallets_with_drift: number;
  drift: WalletDriftRow[];
  ran_at: Date;
};

/**
 * Reconcile every wallet in the system and return a report.  This is
 * a read-only operation; we do NOT auto-correct drift because that
 * masks the underlying bug.  Ops must investigate and post manual
 * adjustments.
 */
export async function reconcileAllWallets(): Promise<ReconciliationReport> {
  const { rows: wallets } = await query<{
    id: string;
    sub_merchant_id: string;
    wallet_type: 'collection' | 'payout';
    available_balance: string;
    reserved_balance: string;
  }>(
    `SELECT id, sub_merchant_id, wallet_type, available_balance, reserved_balance
       FROM wallets
      WHERE status = 'active'`,
  );

  const drift: WalletDriftRow[] = [];
  for (const w of wallets) {
    const derived = await deriveWalletBalance(w.id);
    const storedAvail = Number(w.available_balance);
    const storedRes = Number(w.reserved_balance);
    const availDelta = storedAvail - derived.available;
    const resDelta = storedRes - derived.reserved;
    if (availDelta !== 0 || resDelta !== 0) {
      drift.push({
        wallet_id: w.id,
        sub_merchant_id: w.sub_merchant_id,
        wallet_type: w.wallet_type,
        stored_available: storedAvail,
        derived_available: derived.available,
        stored_reserved: storedRes,
        derived_reserved: derived.reserved,
        available_delta: availDelta,
        reserved_delta: resDelta,
      });
    }
  }

  const report: ReconciliationReport = {
    total_wallets: wallets.length,
    wallets_with_drift: drift.length,
    drift,
    ran_at: new Date(),
  };

  if (drift.length > 0) {
    for (const d of drift) {
      logger.error(
        {
          wallet_id: d.wallet_id,
          wallet_type: d.wallet_type,
          available_delta: d.available_delta,
          reserved_delta: d.reserved_delta,
          stored_available: d.stored_available,
          derived_available: d.derived_available,
        },
        'ledger drift detected',
      );
      await persistDriftEvent(d);
    }
  } else {
    logger.info(
      { total_wallets: wallets.length },
      'ledger reconciliation clean',
    );
  }
  return report;
}

async function persistDriftEvent(d: WalletDriftRow): Promise<void> {
  await query(
    `INSERT INTO ledger_drift_events
       (id, wallet_id, sub_merchant_id, wallet_type,
        stored_available, derived_available, stored_reserved, derived_reserved,
        available_delta, reserved_delta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      newId('auditLog'),
      d.wallet_id,
      d.sub_merchant_id,
      d.wallet_type,
      d.stored_available,
      d.derived_available,
      d.stored_reserved,
      d.derived_reserved,
      d.available_delta,
      d.reserved_delta,
    ],
  );
}
