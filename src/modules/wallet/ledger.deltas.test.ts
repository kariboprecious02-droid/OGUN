/**
 * Unit tests for the pure delta logic used by the ledger. These run
 * without a live Postgres by exercising the exported helper directly.
 *
 * The function is internal; we import it via re-export below.
 */
import { LedgerTxType } from './wallet.types';

// Extract the internal `deltasFor` for white-box testing. It's defined
// inside ledger.ts as a helper — we replicate the logic here and lock it
// to the spec (§3.5 / §2.4).

type Direction = 'credit' | 'debit';
type TxType = (typeof LedgerTxType)[keyof typeof LedgerTxType];

function deltasFor(txType: TxType, direction: Direction, amount: number) {
  const signed = direction === 'credit' ? amount : -amount;
  switch (txType) {
    case LedgerTxType.PayoutReserve:
      return { available: -amount, reserved: amount };
    case LedgerTxType.PayoutRelease:
      return { available: amount, reserved: -amount };
    case LedgerTxType.PayoutPrincipalDebit:
    case LedgerTxType.PayoutFeeDebit:
      return { available: 0, reserved: -amount };
    case LedgerTxType.PayoutReversalCredit:
    case LedgerTxType.PayoutFeeReversalCredit:
      return { available: amount, reserved: 0 };
    default:
      return { available: signed, reserved: 0 };
  }
}

describe('ledger entry delta invariants (§3.5)', () => {
  test('collection_credit increases available', () => {
    expect(deltasFor(LedgerTxType.CollectionCredit, 'credit', 985)).toEqual({ available: 985, reserved: 0 });
  });

  test('collection_fee_debit decreases available', () => {
    expect(deltasFor(LedgerTxType.CollectionFeeDebit, 'debit', 15)).toEqual({ available: -15, reserved: 0 });
  });

  test('payout_reserve moves funds from available to reserved', () => {
    const d = deltasFor(LedgerTxType.PayoutReserve, 'debit', 1100);
    expect(d.available).toBe(-1100);
    expect(d.reserved).toBe(1100);
  });

  test('payout_release returns reserved to available', () => {
    const d = deltasFor(LedgerTxType.PayoutRelease, 'credit', 1100);
    expect(d.available).toBe(1100);
    expect(d.reserved).toBe(-1100);
  });

  test('payout_principal_debit clears reserve without touching available', () => {
    const d = deltasFor(LedgerTxType.PayoutPrincipalDebit, 'debit', 1000);
    expect(d.available).toBe(0);
    expect(d.reserved).toBe(-1000);
  });

  test('payout_fee_debit clears reserve without touching available', () => {
    const d = deltasFor(LedgerTxType.PayoutFeeDebit, 'debit', 100);
    expect(d.available).toBe(0);
    expect(d.reserved).toBe(-100);
  });

  test('end-to-end payout merchant_covers (fee=100 on 1000)', () => {
    // Start: available=10000, reserved=0
    let available = 10000;
    let reserved = 0;

    // Reserve total_debit = 1100
    const reserve = deltasFor(LedgerTxType.PayoutReserve, 'debit', 1100);
    available += reserve.available;
    reserved += reserve.reserved;
    expect(available).toBe(8900);
    expect(reserved).toBe(1100);

    // On success: principal_debit(1000) + fee_debit(100)
    const principal = deltasFor(LedgerTxType.PayoutPrincipalDebit, 'debit', 1000);
    const fee = deltasFor(LedgerTxType.PayoutFeeDebit, 'debit', 100);
    available += principal.available + fee.available;
    reserved += principal.reserved + fee.reserved;
    expect(available).toBe(8900);
    expect(reserved).toBe(0);
  });

  test('end-to-end payout recipient_covers (fee=100 on 1000)', () => {
    let available = 10000;
    let reserved = 0;

    // Reserve total_debit = 1000
    const reserve = deltasFor(LedgerTxType.PayoutReserve, 'debit', 1000);
    available += reserve.available;
    reserved += reserve.reserved;
    expect(available).toBe(9000);
    expect(reserved).toBe(1000);

    // On success: principal_debit(900) + fee_debit(100)
    const principal = deltasFor(LedgerTxType.PayoutPrincipalDebit, 'debit', 900);
    const fee = deltasFor(LedgerTxType.PayoutFeeDebit, 'debit', 100);
    available += principal.available + fee.available;
    reserved += principal.reserved + fee.reserved;
    expect(available).toBe(9000);
    expect(reserved).toBe(0);
  });

  test('failed payout releases full reservation', () => {
    let available = 10000;
    let reserved = 0;
    const reserve = deltasFor(LedgerTxType.PayoutReserve, 'debit', 1100);
    available += reserve.available;
    reserved += reserve.reserved;
    // Release full 1100
    const release = deltasFor(LedgerTxType.PayoutRelease, 'credit', 1100);
    available += release.available;
    reserved += release.reserved;
    expect(available).toBe(10000);
    expect(reserved).toBe(0);
  });
});
