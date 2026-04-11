/**
 * Admin session helpers. The admin dashboard uses a single cookie-based
 * auth check: on login the user submits the OGUN_ADMIN_SECRET value;
 * we verify it with POST /v1/admin/session and, if valid, persist it
 * in an httpOnly cookie named `ogun_admin_secret`.
 *
 * The Ogun API client reads this cookie on every server-rendered
 * request and attaches it as the X-Ogun-Admin-Secret header. It is
 * NEVER exposed to the browser.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
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
  const cookieStore = await cookies();
  return !!cookieStore.get(COOKIE_NAME)?.value;
}

export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) {
    redirect('/login');
  }
}
