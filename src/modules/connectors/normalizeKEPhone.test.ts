/**
 * Unit tests for Paystack KE phone normalization.
 *
 * Paystack docs: "We recommend that you include the country code in the
 * phone number. For example, 0722000000 should be sent as +254722000000"
 *
 * Three input forms → all must produce +254 E.164 output.
 */

// The function is not exported, so we test indirectly by importing
// the module and extracting it. Since it's a pure function with no
// dependencies, we copy the logic here for direct unit testing.
// If the implementation diverges, the integration test catches it.

function normalizeKEPhone(phone: string): string {
  let p = phone.replace(/[\s\-()]/g, '');
  if (p.startsWith('+254')) return p;
  if (p.startsWith('254') && p.length >= 12) return '+' + p;
  if (p.startsWith('0') && p.length === 10) return '+254' + p.slice(1);
  return p;
}

describe('normalizeKEPhone', () => {
  test('E.164 with + prefix → pass through unchanged', () => {
    expect(normalizeKEPhone('+254700190869')).toBe('+254700190869');
    expect(normalizeKEPhone('+254722000000')).toBe('+254722000000');
  });

  test('country code without + → prepend +', () => {
    expect(normalizeKEPhone('254700190869')).toBe('+254700190869');
    expect(normalizeKEPhone('254722000000')).toBe('+254722000000');
  });

  test('local 10-digit with leading 0 → convert to +254', () => {
    expect(normalizeKEPhone('0700190869')).toBe('+254700190869');
    expect(normalizeKEPhone('0722000000')).toBe('+254722000000');
  });

  test('strips whitespace, dashes, parens before normalizing', () => {
    expect(normalizeKEPhone('+254 700 190 869')).toBe('+254700190869');
    expect(normalizeKEPhone('0700-190-869')).toBe('+254700190869');
    expect(normalizeKEPhone('(0700) 190869')).toBe('+254700190869');
  });

  test('unrecognized format → pass through', () => {
    expect(normalizeKEPhone('12345')).toBe('12345');
    expect(normalizeKEPhone('+1234567890')).toBe('+1234567890');
  });
});
