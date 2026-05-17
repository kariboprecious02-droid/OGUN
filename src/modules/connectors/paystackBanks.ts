/**
 * Paystack Kenya bank codes — fetched from GET /bank?country=kenya at startup.
 *
 * The bank list is cached in memory after the first fetch. If the fetch
 * fails (e.g., no network), falls back to a hardcoded snapshot.
 *
 * Used for:
 *   1. Settlement account configuration (admin dropdown)
 *   2. Transfer recipient creation (POST /transferrecipient bank_code field)
 *   3. Bank name → code resolution in dispatch.ts
 */

import axios from 'axios';
import { config } from '@/infra/config';
import { logger } from '@/infra/logger';

export type PaystackKEBank = {
  code: string;
  name: string;
  id: number;
};

let cachedBanks: PaystackKEBank[] | null = null;

export async function fetchPaystackBanks(): Promise<PaystackKEBank[]> {
  if (cachedBanks) return cachedBanks;
  try {
    const { data } = await axios.get('https://api.paystack.co/bank', {
      params: { country: 'kenya' },
      headers: { Authorization: `Bearer ${config.paystack.secretKey}` },
      timeout: 10_000,
    });
    if (data?.status && Array.isArray(data.data)) {
      cachedBanks = (data.data as Array<{ code: string; name: string; id: number }>)
        .filter((b) => b.code && b.name)
        .map((b) => ({ code: b.code, name: b.name, id: b.id }));
      logger.info({ count: cachedBanks.length }, 'fetched Paystack KE bank list');
      return cachedBanks;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'failed to fetch Paystack bank list — using fallback');
  }
  cachedBanks = FALLBACK_BANKS;
  return cachedBanks;
}

export function getBanksSync(): PaystackKEBank[] {
  return cachedBanks ?? FALLBACK_BANKS;
}

export function resolvePaystackBankCode(bankNameOrCode: string): string | null {
  const banks = getBanksSync();
  const normalized = bankNameOrCode.trim().toLowerCase();
  const byCode = banks.find((b) => b.code.toLowerCase() === normalized);
  if (byCode) return byCode.code;
  const byName = banks.find((b) => b.name.toLowerCase() === normalized);
  if (byName) return byName.code;
  const byPartial = banks.find((b) =>
    b.name.toLowerCase().includes(normalized) || normalized.includes(b.name.toLowerCase()),
  );
  if (byPartial) return byPartial.code;
  return null;
}

export function isMobileMoneyCode(code: string): boolean {
  const mobileCodes = getBanksSync()
    .filter((b) => b.name.toLowerCase().includes('m-pesa') || b.name.toLowerCase().includes('airtel') || b.name.toLowerCase().includes('t-kash'))
    .map((b) => b.code);
  return mobileCodes.includes(code);
}

const FALLBACK_BANKS: PaystackKEBank[] = [
  { code: '023', name: 'ABSA Bank Kenya', id: 0 },
  { code: '054', name: 'Access Bank Kenya', id: 0 },
  { code: '056', name: 'Bank of Africa Kenya', id: 0 },
  { code: '003', name: 'Bank of Baroda Kenya', id: 0 },
  { code: '005', name: 'Bank of India Kenya', id: 0 },
  { code: '016', name: 'Citibank Kenya', id: 0 },
  { code: '051', name: 'Consolidated Bank Kenya', id: 0 },
  { code: '011', name: 'Co-operative Bank of Kenya', id: 0 },
  { code: '049', name: 'Credit Bank', id: 0 },
  { code: '063', name: 'Diamond Trust Bank Kenya', id: 0 },
  { code: '074', name: 'DIB Bank Kenya', id: 0 },
  { code: '043', name: 'Ecobank Kenya', id: 0 },
  { code: '068', name: 'Equity Bank Kenya', id: 0 },
  { code: '070', name: 'Family Bank', id: 0 },
  { code: '072', name: 'First Community Bank', id: 0 },
  { code: '053', name: 'Guaranty Trust Bank Kenya', id: 0 },
  { code: '055', name: 'Guardian Bank', id: 0 },
  { code: '019', name: 'Gulf African Bank', id: 0 },
  { code: '061', name: 'Housing Finance Company of Kenya', id: 0 },
  { code: '057', name: 'I&M Bank Kenya', id: 0 },
  { code: '001', name: 'Kenya Commercial Bank', id: 0 },
  { code: '010', name: 'National Bank of Kenya', id: 0 },
  { code: '007', name: 'NCBA Bank Kenya', id: 0 },
  { code: '014', name: 'Oriental Commercial Bank', id: 0 },
  { code: '050', name: 'Paramount Bank', id: 0 },
  { code: '025', name: 'Prime Bank Kenya', id: 0 },
  { code: '075', name: 'SBM Bank Kenya', id: 0 },
  { code: '002', name: 'Standard Chartered Bank Kenya', id: 0 },
  { code: '066', name: 'Sidian Bank', id: 0 },
  { code: '048', name: 'Spire Bank', id: 0 },
  { code: '031', name: 'Stanbic Bank Kenya', id: 0 },
  { code: '076', name: 'United Bank for Africa Kenya', id: 0 },
  { code: '041', name: 'Victoria Commercial Bank', id: 0 },
];
