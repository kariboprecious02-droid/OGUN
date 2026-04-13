/**
 * Admin session helpers.
 *
 * Auth is currently DISABLED: the dashboard is accessible to anyone
 * with the URL. The admin secret used for API calls is read from the
 * server-side OGUN_ADMIN_SECRET env (see lib/api.ts), never from the
 * browser. Re-add login later by gating at a proxy / Cloud Run IAP /
 * Cloudflare Access in front of the admin service.
 *
 * The cookie + loginWithSecret helpers remain for backward compat but
 * are no longer required — requireAuth() is a no-op, isAuthenticated()
 * always returns true.
 */

import { cookies } from 'next/headers';
import { verifyAdminSession } from './api';

const COOKIE_NAME = 'ogun_admin_secret';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

export async function loginWithSecret(secret: string): Promise<boolean> {
  const ok = await verifyAdminSession(secret);
  if (!ok) return false;
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, secret, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return true;
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function isAuthenticated(): Promise<boolean> {
  // Auth disabled — dashboard is accessible to anyone with the URL.
  return true;
}

export async function requireAuth(): Promise<void> {
  // No-op: auth is disabled for now.
}
