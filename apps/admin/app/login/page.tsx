import { redirect } from 'next/navigation';

/**
 * Login is disabled. Anyone with the URL can access the dashboard.
 * We keep this route file so existing bookmarks / redirects to /login
 * don't 404 — it just forwards to the dashboard home.
 *
 * Re-enable login later by restoring the form from git history and
 * flipping requireAuth() back on in lib/session.ts.
 */
export default function LoginPage(): never {
  redirect('/');
}
