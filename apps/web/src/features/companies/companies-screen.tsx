import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BadgeCheck, Building2, Search } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { companiesApi, queryKeys } from '@/lib/api-endpoints';

/** FR-1008 — browsing employers, rather than only meeting them through a role. */
export function CompaniesScreen() {
  const [search, setSearch] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.companies(search, verifiedOnly),
    queryFn: () => companiesApi.browse(search, verifiedOnly),
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Follow an employer to see their roles and updates in your feed.
        </p>
      </header>

      <div className="relative mb-3">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, industry or location"
          aria-label="Search companies"
          className="h-11 w-full rounded-xl border border-border-default bg-surface pr-3 pl-9 text-sm placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
        />
      </div>

      <label className="mb-4 flex w-fit cursor-pointer items-center gap-2 text-sm text-fg-muted">
        <input
          type="checkbox"
          checked={verifiedOnly}
          onChange={(e) => setVerifiedOnly(e.target.checked)}
          className="size-4 cursor-pointer accent-[var(--brand)]"
        />
        Verified employers only
      </label>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-20 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && (data?.items.length ?? 0) === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Building2 />}
            title={search ? 'No companies matched that' : 'No companies yet'}
            description={
              search
                ? 'Try a different name, industry or city.'
                : 'As employers join, you will find them here.'
            }
          />
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {data?.items.map((company) => (
          <li key={company.id}>
            <Link
              to={`/c/${company.id}`}
              className="panel group flex items-center gap-3 p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Avatar name={company.name} src={company.logoUrl} size="md" shape="rounded" />

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-fg">
                  <span className="truncate group-hover:underline">{company.name}</span>
                  {company.isVerified && (
                    <BadgeCheck
                      aria-label="Verified"
                      role="img"
                      className="size-4 shrink-0 text-success"
                      strokeWidth={2.5}
                    />
                  )}
                </p>
                <p className="truncate text-xs text-fg-subtle">
                  {[company.industry, company.headquarters].filter(Boolean).join(' · ') ||
                    'Employer'}
                </p>
              </div>

              <span
                className={cn(
                  'shrink-0 rounded-lg px-2 py-1 text-2xs font-semibold tabular-nums',
                  company.openRoleCount > 0
                    ? 'bg-brand-subtle text-brand-fg'
                    : 'text-fg-faint',
                )}
              >
                {company.openRoleCount > 0
                  ? `${company.openRoleCount} open`
                  : company.isFollowing
                    ? 'Following'
                    : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
