import type { PoolClient } from 'pg';
import { query } from '@/infra/db/pool';
import { WalletRow, WalletType } from './wallet.types';

function toNumber(v: number | string): number {
  return typeof v === 'string' ? Number(v) : v;
}

function normalize(row: WalletRow): WalletRow & { available_balance: number; reserved_balance: number } {
  return {
    ...row,
    available_balance: toNumber(row.available_balance),
    reserved_balance: toNumber(row.reserved_balance),
  } as WalletRow & { available_balance: number; reserved_balance: number };
}

export async function insertWallet(
  client: PoolClient,
  row: { id: string; merchant_id: string; sub_merchant_id: string; wallet_type: WalletType; currency?: string },
): Promise<WalletRow> {
  const { rows } = await client.query<WalletRow>(
    `INSERT INTO wallets (id, merchant_id, sub_merchant_id, wallet_type, currency)
     VALUES ($1, $2, $3, $4, COALESCE($5,'KES'))
     ON CONFLICT (sub_merchant_id, wallet_type, currency) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [row.id, row.merchant_id, row.sub_merchant_id, row.wallet_type, row.currency ?? 'KES'],
  );
  return normalize(rows[0]);
}

export async function findWalletBySub(
  subMerchantId: string,
  walletType: WalletType,
  currency = 'KES',
): Promise<(WalletRow & { available_balance: number; reserved_balance: number }) | null> {
  const { rows } = await query<WalletRow>(
    `SELECT * FROM wallets WHERE sub_merchant_id = $1 AND wallet_type = $2 AND currency = $3 LIMIT 1`,
    [subMerchantId, walletType, currency],
  );
  return rows[0] ? normalize(rows[0]) : null;
}

export async function findWalletById(
  id: string,
  client?: PoolClient,
): Promise<(WalletRow & { available_balance: number; reserved_balance: number }) | null> {
  const res = client
    ? await client.query<WalletRow>(`SELECT * FROM wallets WHERE id = $1 LIMIT 1`, [id])
    : await query<WalletRow>(`SELECT * FROM wallets WHERE id = $1 LIMIT 1`, [id]);
  return res.rows[0] ? normalize(res.rows[0]) : null;
}

export async function lockWalletForUpdate(
  client: PoolClient,
  walletId: string,
): Promise<WalletRow & { available_balance: number; reserved_balance: number }> {
  const { rows } = await client.query<WalletRow>(
    `SELECT * FROM wallets WHERE id = $1 FOR UPDATE`,
    [walletId],
  );
  if (!rows[0]) throw new Error(`Wallet ${walletId} not found`);
  return normalize(rows[0]);
}

export async function adjustWalletBalance(
  client: PoolClient,
  walletId: string,
  availableDelta: number,
  reservedDelta: number,
): Promise<void> {
  await client.query(
    `UPDATE wallets
        SET available_balance = available_balance + $2,
            reserved_balance = reserved_balance + $3,
            updated_at = now()
      WHERE id = $1`,
    [walletId, availableDelta, reservedDelta],
  );
}

export async function listWalletsByMerchant(merchantId: string): Promise<
  Array<WalletRow & { available_balance: number; reserved_balance: number }>
> {
  const { rows } = await query<WalletRow>(
    `SELECT * FROM wallets WHERE merchant_id = $1 ORDER BY sub_merchant_id, wallet_type`,
    [merchantId],
  );
  return rows.map(normalize);
}
