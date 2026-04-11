import { PayoutStatus, isPayoutTerminal } from './payout.types';

describe('payout state machine (§6.1)', () => {
  test('terminal states: succeeded, failed, reversed, cancelled', () => {
    expect(isPayoutTerminal(PayoutStatus.Succeeded)).toBe(true);
    expect(isPayoutTerminal(PayoutStatus.Failed)).toBe(true);
    expect(isPayoutTerminal(PayoutStatus.Reversed)).toBe(true);
    expect(isPayoutTerminal(PayoutStatus.Cancelled)).toBe(true);
  });

  test('non-terminal: created, queued, processing, pending_approval, pending_confirmation', () => {
    expect(isPayoutTerminal(PayoutStatus.Created)).toBe(false);
    expect(isPayoutTerminal(PayoutStatus.Queued)).toBe(false);
    expect(isPayoutTerminal(PayoutStatus.Processing)).toBe(false);
    expect(isPayoutTerminal(PayoutStatus.PendingApproval)).toBe(false);
    expect(isPayoutTerminal(PayoutStatus.PendingConfirmation)).toBe(false);
  });
});
