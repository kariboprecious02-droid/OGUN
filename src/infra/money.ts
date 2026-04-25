/**
 * Money helpers shared between the backend and the admin app.
 *
 * Backend stores amounts as `bigint` minor units (cents). The API
 * normalises bigint -> number on the way out. UI surfaces always show
 * KES (whole shillings, decimal-OK). Conversion happens at exactly two
 * boundaries:
 *
 *   user input (KES)     -> kesToCents -> wire (cents)
 *   wire (cents)         -> centsToKes -> display (KES)
 *
 * Putting the helpers here (rather than in apps/admin/lib/api.ts) lets
 * both src/ and apps/admin/ import them and lets them be unit-tested
 * by the backend Jest harness without pulling in Next.js runtime.
 */

/** Convert a KES amount (whole shillings, may be fractional) to cents. */
export function kesToCents(kes: number): number {
  if (!Number.isFinite(kes) || kes < 0) return 0;
  return Math.round(kes * 100);
}

/** Convert a cents amount back to KES (may be fractional). */
export function centsToKes(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return cents / 100;
}
