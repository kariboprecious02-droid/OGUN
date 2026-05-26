import { ulid } from 'ulid';

/**
 * Ogun ID prefixes per Execution Spec §3.
 * All primary keys are prefixed ULIDs of the form `<prefix>_<ulid>`.
 */
export const IdPrefix = {
  merchant: 'mrc',
  subMerchant: 'smrc',
  merchantSettings: 'mset',
  document: 'doc',
  complianceReview: 'crv',
  complianceRule: 'crl',
  merchantFeedback: 'mfb',
  wallet: 'wal',
  ledgerEntry: 'led',
  collection: 'col',
  collectionAudit: 'cae',
  beneficiary: 'ben',
  payout: 'pay',
  settlement: 'stl',
  settlementLine: 'sli',
  apiCredential: 'cred',
  webhookEndpoint: 'wep',
  webhookDelivery: 'wdl',
  pollingJob: 'pol',
  notificationEndpoint: 'nep',
  auditLog: 'aud',
  event: 'evt',
  request: 'req',
  reversal: 'rev',
  walletTopup: 'tpu',
} as const;

export type IdKind = keyof typeof IdPrefix;

export function newId(kind: IdKind): string {
  return `${IdPrefix[kind]}_${ulid()}`;
}

export function isId(kind: IdKind, value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${IdPrefix[kind]}_`);
}
