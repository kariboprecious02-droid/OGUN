import { config } from '@/infra/config';
import { generateApiKey, hashApiKey, maskKey } from '@/infra/crypto';
import { newId } from '@/infra/ids';
import { OgunError } from '@/infra/errors';
import { findCredentialByHash, insertCredential, deactivateCredentials } from './auth.repository';

export type AuthenticatedPrincipal = {
  merchantId: string;
  keyType: 'secret' | 'publishable';
  environment: 'sandbox' | 'live';
};

/**
 * Validate a Bearer credential presented in the Authorization header.
 * Rejects publishable keys for secret-only routes at the caller layer.
 */
export async function authenticateBearer(token: string): Promise<AuthenticatedPrincipal> {
  if (!token || (!token.startsWith('sk_') && !token.startsWith('pk_'))) {
    throw OgunError.unauthorized();
  }
  const hashed = hashApiKey(token, config.platform.webhookSigningSalt);
  const credential = await findCredentialByHash(hashed);
  if (!credential) throw OgunError.unauthorized();
  if (credential.key_type === 'webhook_secret') throw OgunError.unauthorized();
  return {
    merchantId: credential.merchant_id,
    keyType: credential.key_type as 'secret' | 'publishable',
    environment: credential.environment,
  };
}

/**
 * Issue a fresh credential triple (publishable + secret + webhook_secret)
 * for both sandbox and live environments. Returned ONCE in plaintext.
 */
export type IssuedCredentialSet = {
  sandbox: { publishable: string; secret: string; webhookSecret: string };
  live: { publishable: string; secret: string; webhookSecret: string };
};

export async function issueCredentials(merchantId: string): Promise<IssuedCredentialSet> {
  const set: IssuedCredentialSet = {
    sandbox: {
      publishable: generateApiKey('pk', 'test'),
      secret: generateApiKey('sk', 'test'),
      webhookSecret: generateApiKey('whsec', 'test'),
    },
    live: {
      publishable: generateApiKey('pk', 'live'),
      secret: generateApiKey('sk', 'live'),
      webhookSecret: generateApiKey('whsec', 'live'),
    },
  };

  const rows: Array<Parameters<typeof insertCredential>[0]> = [
    { id: newId('apiCredential'), merchant_id: merchantId, key_type: 'publishable', masked_value: maskKey(set.sandbox.publishable), hashed_value: hashApiKey(set.sandbox.publishable, config.platform.webhookSigningSalt), environment: 'sandbox' },
    { id: newId('apiCredential'), merchant_id: merchantId, key_type: 'secret', masked_value: maskKey(set.sandbox.secret), hashed_value: hashApiKey(set.sandbox.secret, config.platform.webhookSigningSalt), environment: 'sandbox' },
    { id: newId('apiCredential'), merchant_id: merchantId, key_type: 'webhook_secret', masked_value: maskKey(set.sandbox.webhookSecret), hashed_value: hashApiKey(set.sandbox.webhookSecret, config.platform.webhookSigningSalt), environment: 'sandbox' },
    { id: newId('apiCredential'), merchant_id: merchantId, key_type: 'publishable', masked_value: maskKey(set.live.publishable), hashed_value: hashApiKey(set.live.publishable, config.platform.webhookSigningSalt), environment: 'live' },
    { id: newId('apiCredential'), merchant_id: merchantId, key_type: 'secret', masked_value: maskKey(set.live.secret), hashed_value: hashApiKey(set.live.secret, config.platform.webhookSigningSalt), environment: 'live' },
    { id: newId('apiCredential'), merchant_id: merchantId, key_type: 'webhook_secret', masked_value: maskKey(set.live.webhookSecret), hashed_value: hashApiKey(set.live.webhookSecret, config.platform.webhookSigningSalt), environment: 'live' },
  ];

  for (const row of rows) {
    await insertCredential(row);
  }

  return set;
}

export async function rotateKey(
  merchantId: string,
  keyType: 'publishable' | 'secret' | 'webhook_secret',
  environment: 'sandbox' | 'live',
): Promise<string> {
  await deactivateCredentials(merchantId, keyType, environment);
  const prefix = keyType === 'publishable' ? 'pk' : keyType === 'secret' ? 'sk' : 'whsec';
  const envTag = environment === 'sandbox' ? 'test' : 'live';
  const newKey = generateApiKey(prefix, envTag);
  await insertCredential({
    id: newId('apiCredential'),
    merchant_id: merchantId,
    key_type: keyType,
    masked_value: maskKey(newKey),
    hashed_value: hashApiKey(newKey, config.platform.webhookSigningSalt),
    environment,
  });
  return newKey;
}
