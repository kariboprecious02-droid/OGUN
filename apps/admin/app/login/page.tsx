import { loginWithSecret } from '@/lib/session';
import { redirect } from 'next/navigation';

async function login(formData: FormData): Promise<void> {
  'use server';
  const secret = String(formData.get('secret') ?? '');
  if (!secret) redirect('/login?err=missing');
  const ok = await loginWithSecret(secret);
  if (!ok) redirect('/login?err=invalid');
  redirect('/');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const err = typeof params.err === 'string' ? params.err : null;
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="panel-padded w-full max-w-md">
        <h1 className="text-2xl font-semibold text-ogun-accent mb-1">Ogun Admin</h1>
        <p className="text-sm text-ogun-muted mb-6">
          Enter the platform admin secret to sign in.
        </p>
        {err === 'invalid' && (
          <div className="text-ogun-danger text-sm mb-4">Invalid admin secret.</div>
        )}
        {err === 'missing' && (
          <div className="text-ogun-danger text-sm mb-4">Admin secret is required.</div>
        )}
        <form action={login} className="space-y-4">
          <div>
            <label htmlFor="secret" className="block text-sm text-ogun-muted mb-1">
              Admin secret
            </label>
            <input
              id="secret"
              name="secret"
              type="password"
              autoComplete="off"
              autoFocus
              className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent outline-none font-mono text-sm"
            />
          </div>
          <button type="submit" className="btn btn-primary w-full justify-center">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
