/**
 * Cross-merchant aggregation helpers used by the admin dashboards. Computed
 * client-side (in server components) from the existing /admin/* list
 * endpoints — the validation report defers /summary backend endpoints since
 * data volumes are demo-scale.
 */

import type {
  CollectionSummary,
  PayoutSummary,
  SettlementSummary,
  MerchantSummary,
} from '@/lib/api';

export type CollectionsRollup = {
  tpv_cents: number;
  count: number;
  success_count: number;
  success_rate: number; // TPV-weighted
  pending: number;
  failed: number;
  per_merchant: Map<string, { tpv_cents: number; count: number; success_count: number }>;
};

export function rollupCollections(items: CollectionSummary[]): CollectionsRollup {
  const acc: CollectionsRollup = {
    tpv_cents: 0,
    count: items.length,
    success_count: 0,
    success_rate: 0,
    pending: 0,
    failed: 0,
    per_merchant: new Map(),
  };
  let weightedSuccessNum = 0;
  let weightedSuccessDen = 0;
  for (const c of items) {
    const amt = Number(c.amount ?? 0);
    acc.tpv_cents += amt;
    if (c.business_status === 'successful') {
      acc.success_count += 1;
      weightedSuccessNum += amt;
    }
    if (c.business_status === 'pending') acc.pending += 1;
    if (c.business_status === 'failed') acc.failed += 1;
    weightedSuccessDen += amt;
    const m = acc.per_merchant.get(c.merchant_id) ?? {
      tpv_cents: 0,
      count: 0,
      success_count: 0,
    };
    m.tpv_cents += amt;
    m.count += 1;
    if (c.business_status === 'successful') m.success_count += 1;
    acc.per_merchant.set(c.merchant_id, m);
  }
  acc.success_rate = weightedSuccessDen > 0 ? weightedSuccessNum / weightedSuccessDen : 0;
  return acc;
}

export type PayoutsRollup = {
  volume_cents: number;
  count: number;
  success_count: number;
  success_rate: number; // volume-weighted (recipient_amount weight)
  pending: number;
  failed: number;
  per_merchant: Map<
    string,
    { volume_cents: number; count: number; success_count: number }
  >;
};

export function rollupPayouts(items: PayoutSummary[]): PayoutsRollup {
  const acc: PayoutsRollup = {
    volume_cents: 0,
    count: items.length,
    success_count: 0,
    success_rate: 0,
    pending: 0,
    failed: 0,
    per_merchant: new Map(),
  };
  let weightedNum = 0;
  let weightedDen = 0;
  for (const p of items) {
    const amt = Number(p.total_debit ?? p.amount ?? 0);
    acc.volume_cents += amt;
    if (p.status === 'succeeded') {
      acc.success_count += 1;
      weightedNum += amt;
    }
    if (
      p.status === 'pending_approval' ||
      p.status === 'pending_confirmation' ||
      p.status === 'queued' ||
      p.status === 'processing'
    ) {
      acc.pending += 1;
    }
    if (p.status === 'failed' || p.status === 'reversed' || p.status === 'cancelled') {
      acc.failed += 1;
    }
    weightedDen += amt;
    const m = acc.per_merchant.get(p.merchant_id) ?? {
      volume_cents: 0,
      count: 0,
      success_count: 0,
    };
    m.volume_cents += amt;
    m.count += 1;
    if (p.status === 'succeeded') m.success_count += 1;
    acc.per_merchant.set(p.merchant_id, m);
  }
  acc.success_rate = weightedDen > 0 ? weightedNum / weightedDen : 0;
  return acc;
}

export type SettlementsRollup = {
  gross_cents: number;
  net_cents: number;
  settlement_fee_cents: number;
  count: number;
  settled_count: number;
  scheduled_count: number;
  per_merchant: Map<
    string,
    {
      gross_cents: number;
      net_cents: number;
      settlement_fee_cents: number;
      count: number;
    }
  >;
};

export function rollupSettlements(items: SettlementSummary[]): SettlementsRollup {
  const acc: SettlementsRollup = {
    gross_cents: 0,
    net_cents: 0,
    settlement_fee_cents: 0,
    count: items.length,
    settled_count: 0,
    scheduled_count: 0,
    per_merchant: new Map(),
  };
  for (const s of items) {
    const gross = Number(s.gross_amount ?? 0);
    const net = Number(s.net_amount ?? 0);
    const settlementFee = Number(s.settlement_fee ?? 0);
    acc.gross_cents += gross;
    acc.net_cents += net;
    acc.settlement_fee_cents += settlementFee;
    if (s.status === 'paid' || s.status === 'settled') acc.settled_count += 1;
    if (s.status === 'scheduled') acc.scheduled_count += 1;
    const m = acc.per_merchant.get(s.merchant_id) ?? {
      gross_cents: 0,
      net_cents: 0,
      settlement_fee_cents: 0,
      count: 0,
    };
    m.gross_cents += gross;
    m.net_cents += net;
    m.settlement_fee_cents += settlementFee;
    m.count += 1;
    acc.per_merchant.set(s.merchant_id, m);
  }
  return acc;
}

/**
 * Build a quick lookup for merchant id → display name. Pass in the result of
 * `listMerchants` so callers can resolve `merchant_id` to a label.
 */
export function nameLookup(
  merchants: MerchantSummary[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of merchants) {
    m.set(x.id, x.legal_name || x.trading_name || x.id);
  }
  return m;
}
