/**
 * Connector registry — routes collection/payout requests to the
 * appropriate provider connector.
 *
 * Default provider for all collection methods: Paystack.
 * Override per-method via COLLECTION_PROVIDER_OVERRIDES env var
 * (e.g., "mpesa=safaricom" to route M-Pesa to Daraja direct).
 *
 * Payouts route exclusively through Paystack.
 */

import { CollectionConnector, PayoutConnector } from './types';
import { SafaricomCollectionConnector } from './safaricom.connector';
import { PaystackCollectionConnector } from './paystack.collection.connector';
import { PaystackPayoutConnector } from './paystack.payout.connector';
import { DemoCollectionConnector, DemoPayoutConnector } from './demo.connector';
import { OgunError } from '@/infra/errors';
import { config } from '@/infra/config';

const collectionConnectors = new Map<string, CollectionConnector>();
const payoutConnectors = new Map<string, PayoutConnector>();

function parseOverrides(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(',')) {
    const [method, provider] = pair.split('=');
    if (method?.trim() && provider?.trim()) {
      map.set(method.trim(), provider.trim());
    }
  }
  return map;
}

const collectionOverrides = parseOverrides(
  config.connectors.collectionProviderOverrides,
);

export function initRegistry(): void {
  const safaricom = new SafaricomCollectionConnector();
  const paystackColl = new PaystackCollectionConnector();
  const demo = new DemoCollectionConnector();
  collectionConnectors.set('safaricom', safaricom);
  collectionConnectors.set('paystack', paystackColl);
  collectionConnectors.set('demo', demo);

  const paystackPayout = new PaystackPayoutConnector();
  const demoPayout = new DemoPayoutConnector();
  payoutConnectors.set('paystack', paystackPayout);
  payoutConnectors.set('demo', demoPayout);
}

export function pickCollectionProvider(method: string): {
  provider: string;
  connector: CollectionConnector;
} {
  if (!collectionConnectors.size) initRegistry();

  if (method === 'demo') {
    const c = collectionConnectors.get('demo');
    if (!c) throw OgunError.methodNotEnabled(method);
    return { provider: 'demo', connector: c };
  }

  const providerName = collectionOverrides.get(method) ?? 'paystack';
  const c = collectionConnectors.get(providerName);
  if (!c) throw OgunError.methodNotEnabled(method);
  return { provider: providerName, connector: c };
}

export function pickPayoutProvider(method: string, envIsSandbox: boolean): {
  provider: string;
  internalMethod: 'paystack_mobile_money' | 'paystack_kepss' | 'demo_payout';
  connector: PayoutConnector;
} {
  if (!payoutConnectors.size) initRegistry();
  if (method === 'demo' || envIsSandbox) {
    const connector = envIsSandbox && method !== 'demo'
      ? payoutConnectors.get('paystack')!
      : payoutConnectors.get('demo')!;
    const internal: 'paystack_mobile_money' | 'paystack_kepss' | 'demo_payout' =
      method === 'mobile_money'
        ? 'paystack_mobile_money'
        : method === 'bank_transfer'
        ? 'paystack_kepss'
        : 'demo_payout';
    return { provider: connector === payoutConnectors.get('demo') ? 'demo' : 'paystack', internalMethod: internal, connector };
  }
  switch (method) {
    case 'mobile_money':
      return {
        provider: 'paystack',
        internalMethod: 'paystack_mobile_money',
        connector: payoutConnectors.get('paystack')!,
      };
    case 'bank_transfer':
      return {
        provider: 'paystack',
        internalMethod: 'paystack_kepss',
        connector: payoutConnectors.get('paystack')!,
      };
    default:
      throw OgunError.methodNotEnabled(method);
  }
}

export function getCollectionConnector(provider: string): CollectionConnector {
  if (!collectionConnectors.size) initRegistry();
  const c = collectionConnectors.get(provider);
  if (!c) throw OgunError.invalidRequest(`Unknown collection provider: ${provider}`);
  return c;
}

export function getPayoutConnector(provider: string): PayoutConnector {
  if (!payoutConnectors.size) initRegistry();
  const c = payoutConnectors.get(provider);
  if (!c) throw OgunError.invalidRequest(`Unknown payout provider: ${provider}`);
  return c;
}
