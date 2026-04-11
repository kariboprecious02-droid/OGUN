import { computeCollectionFee, computePayoutFee } from './fees';

describe('collection fee calculation (§5.7)', () => {
  test('merchant_covers: customer pays amount, wallet credited net of fee', () => {
    const s = computeCollectionFee(1000, 1.5, 'merchant_covers', 'KES');
    expect(s.fee_amount).toBe(15);
    expect(s.customer_amount).toBe(1000);
    expect(s.wallet_credit).toBe(985);
  });

  test('payer_covers: customer pays amount+fee, wallet credited gross', () => {
    const s = computeCollectionFee(1000, 1.5, 'payer_covers', 'KES');
    expect(s.fee_amount).toBe(15);
    expect(s.customer_amount).toBe(1015);
    expect(s.wallet_credit).toBe(1000);
  });

  test('fee is rounded (banker-neutral) to whole cents', () => {
    const s = computeCollectionFee(333, 1.5, 'merchant_covers', 'KES');
    expect(s.fee_amount).toBe(Math.round(333 * 1.5 / 100));
  });
});

describe('payout fee calculation (§6.4)', () => {
  // Spec examples (§6.4.1 / §6.4.2)
  test('recipient_covers: fee=100 on 1000 payout', () => {
    const s = computePayoutFee(1000, 10, 'recipient_covers', 'KES');
    expect(s.fee_amount).toBe(100);
    expect(s.total_debit).toBe(1000); // wallet debited amount only
    expect(s.recipient_amount).toBe(900); // recipient gets amount - fee
  });

  test('merchant_covers: fee=100 on 1000 payout', () => {
    const s = computePayoutFee(1000, 10, 'merchant_covers', 'KES');
    expect(s.fee_amount).toBe(100);
    expect(s.total_debit).toBe(1100); // wallet debited amount + fee
    expect(s.recipient_amount).toBe(1000); // recipient gets full amount
  });

  test('recipient_amount never exceeds principal', () => {
    const s = computePayoutFee(5000, 1.0, 'recipient_covers', 'KES');
    expect(s.recipient_amount).toBeLessThanOrEqual(s.amount);
    expect(s.total_debit).toBe(5000);
  });
});
