import {
  hmacSha256Hex,
  sha256Hex,
  timingSafeEquals,
  generateApiKey,
  maskKey,
  hashApiKey,
  encryptSecret,
  decryptSecret,
} from './crypto';

describe('HMAC-SHA256 helper', () => {
  test('stable output for fixed input and key', () => {
    const sig = hmacSha256Hex('hello', 'secret');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacSha256Hex('hello', 'secret')).toBe(sig);
  });

  test('different key → different signature', () => {
    expect(hmacSha256Hex('x', 'a')).not.toBe(hmacSha256Hex('x', 'b'));
  });
});

describe('SHA-256 helper', () => {
  test('64-char hex output', () => {
    expect(sha256Hex('ogun')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('timingSafeEquals', () => {
  test('equal strings return true', () => {
    expect(timingSafeEquals('abc', 'abc')).toBe(true);
  });

  test('different strings return false', () => {
    expect(timingSafeEquals('abc', 'xyz')).toBe(false);
  });

  test('different-length strings return false', () => {
    expect(timingSafeEquals('a', 'ab')).toBe(false);
  });
});

describe('API key generation', () => {
  test('sk_live_ prefix and reasonable length', () => {
    const k = generateApiKey('sk', 'live');
    expect(k).toMatch(/^sk_live_/);
    expect(k.length).toBeGreaterThan(30);
  });

  test('pk_test_ prefix for publishable test keys', () => {
    expect(generateApiKey('pk', 'test')).toMatch(/^pk_test_/);
  });
});

describe('maskKey', () => {
  test('masks long keys with prefix/suffix', () => {
    const masked = maskKey('sk_live_deadbeefdeadbeef');
    expect(masked).toContain('...');
    expect(masked).toMatch(/^sk_live_/);
  });

  test('short keys get truncated with stars', () => {
    expect(maskKey('short')).toContain('***');
  });
});

describe('hashApiKey', () => {
  test('deterministic for fixed salt', () => {
    const h = hashApiKey('sk_live_abc', 'salt');
    expect(h).toBe(hashApiKey('sk_live_abc', 'salt'));
  });

  test('salt changes the output', () => {
    expect(hashApiKey('sk_live_abc', 'salt1')).not.toBe(hashApiKey('sk_live_abc', 'salt2'));
  });
});

describe('encryptSecret / decryptSecret (AES-256-GCM round-trip)', () => {
  test('round-trips plaintext', () => {
    const plain = 'whsec_test_super_secret_value';
    const enc = encryptSecret(plain, 'salt');
    expect(enc).toMatch(/^v1\./);
    expect(decryptSecret(enc, 'salt')).toBe(plain);
  });

  test('encryption is non-deterministic (fresh IV each call)', () => {
    const a = encryptSecret('same-plaintext', 'salt');
    const b = encryptSecret('same-plaintext', 'salt');
    expect(a).not.toBe(b);
  });

  test('wrong salt fails to decrypt', () => {
    const enc = encryptSecret('secret', 'salt-a');
    expect(() => decryptSecret(enc, 'salt-b')).toThrow();
  });

  test('tampered envelope fails to decrypt', () => {
    const enc = encryptSecret('secret', 'salt');
    const parts = enc.split('.');
    // Flip a byte in the ciphertext
    parts[3] = parts[3].slice(0, -2) + 'AA';
    expect(() => decryptSecret(parts.join('.'), 'salt')).toThrow();
  });
});
