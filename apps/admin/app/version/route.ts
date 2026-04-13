import { NextResponse } from 'next/server';

/**
 * Admin build probe + live API test.
 *
 * Hitting this URL returns build info AND performs a live call to the
 * API's admin endpoint so we can see exactly what error (if any) the
 * dashboard would hit. Way faster than guessing or adding console.log
 * to individual pages.
 */

export const dynamic = 'force-dynamic';

async function testApiCall(): Promise<Record<string, unknown>> {
  const baseUrl = process.env.OGUN_API_BASE_URL || 'http://localhost:4000/v1';
  const secret = process.env.OGUN_ADMIN_SECRET || 'changeme-set-in-prod';
  const url = `${baseUrl}/admin/merchants?status=active&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { 'X-Ogun-Admin-Secret': secret, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    return {
      url,
      status: res.status,
      ok: res.ok,
      body,
    };
  } catch (err) {
    return {
      url,
      error: err instanceof Error ? err.message : String(err),
      error_type: err instanceof Error ? err.constructor.name : typeof err,
    };
  }
}

export async function GET(): Promise<NextResponse> {
  const apiTest = await testApiCall();
  return NextResponse.json({
    app: 'ogun-admin',
    build: 'api-test-4',
    login_disabled: true,
    commit: process.env.COMMIT_SHA || 'unknown',
    api_base_url: process.env.OGUN_API_BASE_URL || 'unset',
    admin_secret_length: (process.env.OGUN_ADMIN_SECRET || 'changeme-set-in-prod').length,
    api_test: apiTest,
  });
}
