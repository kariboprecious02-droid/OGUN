import { redirect } from 'next/navigation';

/**
 * `/compliance/new` is a back-compat alias. The create-merchant form lives
 * inside the onboarding wizard now at `/merchants/onboarding/new`.
 */
export default function ComplianceNewRedirect(): never {
  redirect('/merchants/onboarding/new');
}
