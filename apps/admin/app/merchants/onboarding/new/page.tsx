import { redirect } from 'next/navigation';

/**
 * `/merchants/onboarding/new` — alias to the existing create-merchant form
 * at `/compliance/new` (which is already PRD-complete per the validation
 * report §5). After successful create, that form now redirects into the
 * onboarding wizard at `/merchants/onboarding/[id]`.
 *
 * This indirection lets us migrate the create form into this directory
 * later without breaking external links.
 */
export default function OnboardingNewPage(): never {
  redirect('/compliance/new');
}
