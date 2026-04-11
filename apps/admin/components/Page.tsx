import { Nav } from './Nav';

export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <Nav />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            {subtitle && <p className="text-sm text-ogun-muted mt-1">{subtitle}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}
