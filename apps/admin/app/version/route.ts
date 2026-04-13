import { NextResponse } from 'next/server';

/**
 * Admin build probe + live API tests for every endpoint the home
 * page hits. Any endpoint that doesn't return status:200 is our
 * crash culprit.
 */

export const dynamic = 'force-dynamic';

async function testEndpoint(
  label: string,
  path: string,
): Promise<Record<string, unknown>> {
  const baseUrl = process.env.OGUN_API_BASE_URL || 'http://localhost:4000/v1';
  const secret = process.env.OGUN_ADMIN_SECRET || 'changeme-set-in-prod';
  const url = `${baseUrl}${path}`;
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
      body = text.slice(0, 300);
    }
    return { label, url, status: res.status, ok: res.ok, body };
  } catch (err) {
    return {
      label,
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(): Promise<NextResponse> {
  const tests = await Promise.all([
    testEndpoint('merchants_pending', '/admin/merchants?status=under_manual_review&limit=1'),
    testEndpoint('merchants_active', '/admin/merchants?status=active&limit=1'),
    testEndpoint('wallets', '/admin/wallets?limit=5'),
    testEndpoint('collections', '/admin/collections?limit=5'),
    testEndpoint('payouts', '/admin/payouts?limit=5'),
  ]);
  return NextResponse.json({
    app: 'ogun-admin',
    build: 'all-endpoints-5',
    login_disabled: true,
    commit: process.env.COMMIT_SHA || 'unknown',
    api_base_url: process.env.OGUN_API_BASE_URL || 'unset',
    api_tests: tests,
  });
}
