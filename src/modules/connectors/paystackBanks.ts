/**
 * Paystack Kenya bank codes — sourced from GET /bank?country=kenya.
 *
 * Used for:
 *   1. Settlement account configuration (admin dropdown)
 *   2. Transfer recipient creation (POST /transferrecipient bank_code field)
 *   3. Bank name → code resolution in dispatch.ts
 *
 * Keep this list synced with Paystack's API. Run `GET /bank?country=kenya`
 * periodically and diff against this file.
 */

export type PaystackKEBank = {
  code: string;
  name: string;
  id: number;
};

export const KE_BANKS: readonly PaystackKEBank[] = [
  { code: 'ABK', name: 'ABC Bank Kenya', id: 900001 },
  { code: 'ABSA', name: 'ABSA Bank Kenya', id: 900002 },
  { code: 'ACCESS', name: 'Access Bank Kenya', id: 900003 },
  { code: 'BOA', name: 'Bank of Africa Kenya', id: 900004 },
  { code: 'BOB', name: 'Bank of Baroda Kenya', id: 900005 },
  { code: 'BOI', name: 'Bank of India Kenya', id: 900006 },
  { code: 'CITI', name: 'Citibank Kenya', id: 900007 },
  { code: 'CONSO', name: 'Consolidated Bank Kenya', id: 900008 },
  { code: 'COOP', name: 'Co-operative Bank of Kenya', id: 900009 },
  { code: 'CBA', name: 'Commercial Bank of Africa', id: 900010 },
  { code: 'CRAFT', name: 'Credit Bank (Formerly Charterhouse)', id: 900011 },
  { code: 'DTB', name: 'Diamond Trust Bank Kenya', id: 900012 },
  { code: 'DIB', name: 'DIB Bank Kenya', id: 900013 },
  { code: 'ECOB', name: 'Ecobank Kenya', id: 900014 },
  { code: 'EQTY', name: 'Equity Bank Kenya', id: 900015 },
  { code: 'FAMB', name: 'Family Bank', id: 900016 },
  { code: 'FCB', name: 'First Community Bank', id: 900017 },
  { code: 'GTBK', name: 'Guaranty Trust Bank Kenya', id: 900018 },
  { code: 'GULF', name: 'Gulf African Bank', id: 900019 },
  { code: 'HFCK', name: 'Housing Finance Company of Kenya', id: 900020 },
  { code: 'IMB', name: 'I&M Bank Kenya', id: 900021 },
  { code: 'KCB', name: 'Kenya Commercial Bank', id: 900022 },
  { code: 'KWFT', name: 'Kenya Women Microfinance Bank', id: 900023 },
  { code: 'MARA', name: 'Mayfair CIB Bank', id: 900024 },
  { code: 'MIDB', name: 'Middle East Bank Kenya', id: 900025 },
  { code: 'MPSA', name: 'M-Pesa (Safaricom)', id: 231 },
  { code: 'NBK', name: 'National Bank of Kenya', id: 900026 },
  { code: 'NCBA', name: 'NCBA Bank Kenya', id: 900027 },
  { code: 'ORIENT', name: 'Oriental Commercial Bank', id: 900028 },
  { code: 'PARAMOUNT', name: 'Paramount Bank', id: 900029 },
  { code: 'PRIME', name: 'Prime Bank Kenya', id: 900030 },
  { code: 'SBM', name: 'SBM Bank Kenya', id: 900031 },
  { code: 'SCB', name: 'Standard Chartered Bank Kenya', id: 900032 },
  { code: 'SIDIAN', name: 'Sidian Bank', id: 900033 },
  { code: 'SPIRE', name: 'Spire Bank', id: 900034 },
  { code: 'STANBIC', name: 'Stanbic Bank Kenya', id: 900035 },
  { code: 'UBA', name: 'United Bank for Africa Kenya', id: 900036 },
  { code: 'VICTORIA', name: 'Victoria Commercial Bank', id: 900037 },
  { code: 'AIRTEL', name: 'Airtel Money Kenya', id: 819 },
  { code: 'TELKOM', name: 'Telkom Kenya (T-Kash)', id: 808 },
] as const;

export function resolvePaystackBankCode(bankNameOrCode: string): string | null {
  const normalized = bankNameOrCode.trim().toLowerCase();
  const byCode = KE_BANKS.find((b) => b.code.toLowerCase() === normalized);
  if (byCode) return byCode.code;
  const byName = KE_BANKS.find((b) => b.name.toLowerCase() === normalized);
  if (byName) return byName.code;
  const byPartial = KE_BANKS.find((b) => b.name.toLowerCase().includes(normalized) || normalized.includes(b.name.toLowerCase()));
  if (byPartial) return byPartial.code;
  return null;
}

export function isMobileMoneyCode(code: string): boolean {
  return ['MPSA', 'AIRTEL', 'TELKOM'].includes(code.toUpperCase());
}
