import { NextResponse } from 'next/server';

/**
 * Admin build probe. Lets us confirm which build of the admin app is
 * actually running on Cloud Run — mirrors /_admin-probe on the API.
 *
 * Bump `build` below whenever you push an admin-affecting change so
 * hitting this URL reveals whether staging has picked up the new code.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    app: 'ogun-admin',
    build: 'api-url-runtime-3',
    login_disabled: true,
    commit: process.env.COMMIT_SHA || 'unknown',
    api_base_url: process.env.OGUN_API_BASE_URL || 'unset',
  });
}
