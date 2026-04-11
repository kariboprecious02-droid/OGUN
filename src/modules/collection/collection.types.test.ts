import {
  CollectionInternalStatus,
  CollectionBusinessStatus,
  toBusinessStatus,
  isTerminal,
} from './collection.types';

describe('collection dual-state mapping (§5.2.1)', () => {
  test.each([
    ['created', CollectionBusinessStatus.Pending],
    ['pending_submission', CollectionBusinessStatus.Pending],
    ['submitted', CollectionBusinessStatus.Pending],
    ['pending_customer_action', CollectionBusinessStatus.Pending],
    ['processing', CollectionBusinessStatus.Pending],
    ['succeeded', CollectionBusinessStatus.Successful],
    ['failed', CollectionBusinessStatus.Failed],
    ['expired', CollectionBusinessStatus.Failed],
    ['cancelled', CollectionBusinessStatus.Failed],
    ['timed_out', CollectionBusinessStatus.Failed],
    ['refunded', CollectionBusinessStatus.Refunded],
    ['reversed', CollectionBusinessStatus.Refunded],
  ])('internal %s -> business %s', (internal, expected) => {
    expect(toBusinessStatus(internal as keyof typeof CollectionInternalStatus as never)).toBe(expected);
  });

  test('terminal states identified correctly', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('timed_out')).toBe(true);
    expect(isTerminal('refunded')).toBe(true);
    expect(isTerminal('pending_customer_action')).toBe(false);
    expect(isTerminal('created')).toBe(false);
  });
});
