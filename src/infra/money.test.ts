/**
 * Unit tests for the money helpers used by the onboarding wizard.
 * Covers exact round-trips at boundary values + non-finite handling.
 */

import { kesToCents, centsToKes } from '@/infra/money';

describe('money helpers', () => {
  describe('kesToCents', () => {
    test('zero KES -> 0 cents', () => {
      expect(kesToCents(0)).toBe(0);
    });
    test('1 KES -> 100 cents', () => {
      expect(kesToCents(1)).toBe(100);
    });
    test('150,000 KES -> 15,000,000 cents', () => {
      expect(kesToCents(150_000)).toBe(15_000_000);
    });
    test('9,999,999 KES -> 999,999,900 cents', () => {
      expect(kesToCents(9_999_999)).toBe(999_999_900);
    });
    test('fractional KES rounds via Math.round', () => {
      // 1.5 KES -> 150 cents (no float weirdness here)
      expect(kesToCents(1.5)).toBe(150);
      // 1.234 KES -> 123 cents (rounded down)
      expect(kesToCents(1.234)).toBe(123);
      // 1.236 KES -> 124 cents (rounded up)
      expect(kesToCents(1.236)).toBe(124);
    });
    test('negative -> 0 (defensive)', () => {
      expect(kesToCents(-1)).toBe(0);
    });
    test('NaN -> 0', () => {
      expect(kesToCents(Number.NaN)).toBe(0);
    });
    test('Infinity -> 0', () => {
      expect(kesToCents(Number.POSITIVE_INFINITY)).toBe(0);
    });
  });

  describe('centsToKes', () => {
    test('0 cents -> 0 KES', () => {
      expect(centsToKes(0)).toBe(0);
    });
    test('100 cents -> 1 KES', () => {
      expect(centsToKes(100)).toBe(1);
    });
    test('15,000,000 cents -> 150,000 KES', () => {
      expect(centsToKes(15_000_000)).toBe(150_000);
    });
    test('999,999,900 cents -> 9,999,999 KES', () => {
      expect(centsToKes(999_999_900)).toBe(9_999_999);
    });
    test('NaN -> 0', () => {
      expect(centsToKes(Number.NaN)).toBe(0);
    });
  });

  describe('round-trip', () => {
    test.each([0, 1, 100, 150_000, 9_999_999])(
      'kesToCents -> centsToKes returns input for %d',
      (kes) => {
        expect(centsToKes(kesToCents(kes))).toBe(kes);
      },
    );
  });
});
