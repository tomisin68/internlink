import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, Compass, Hash, Search, Users } from 'lucide-react';
import type { SearchScope } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { compactCount, relativeTime } from '@/lib/format';
import { queryKeys, searchApi } from '@/lib/api-endpoints';
import { PersonRow } from '@/features/network/person-row';

const TABS: Array<{ id: SearchScope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'people', label: 'People' },
  { id: 'companies', label: 'Companies' },
  { id: 'posts', label: 'Posts' },
];

/**
 * FR-1006 — one box across people, companies, posts and hashtags.
 *
 * The term lives in the URL so a search is shareable and survives a reload,
 * and so the back button steps through searches the way people expect it to.
 *
 * Typing is debounced rather than requiring a submit: search-as-you-type is
 * what the box looks like it does, and a 250ms pause is short enough to feel
 * immediate while cutting the request count by roughly the length of the word.
 */
export function SearchScreen() {
  const [params, setParams] = useSearchParams();

  const urlTerm = params.get('q') ?? '';
  const scope = (params.get('scope') as SearchScope) || 'all';

  const [draft, setDraft] = useState(urlTerm);
  const [debounced, setDebounced] = useState(urlTerm);

  // Keep the field in step when the URL changes underneath it — a tag chip on
  // this very page navigates by rewriting the query string.
  useEffect(() => setDraft(urlTerm), [urlTerm]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(draft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    if (debounced === urlTerm) return;
    const next = new URLSearchParams(params);
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    setParams(next, { replace: true });
    // `params` is deliberately absent: including it re-runs this on every
    // unrelated query-string change and fights the user's own navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.search(debounced, scope),
    queryFn: () => searchApi.run(debounced, scope),
    enabled: debounced.length > 0,
  });

  function setScope(next: SearchScope): void {
    const updated = new URLSearchParams(params);
    updated.set('scope', next);
    setParams(updated, { replace: true });
  }

  const counts = useMemo(
    () => ({
      people: data?.people.length ?? 0,
      companies: data?.companies.length ?? 0,
      posts: data?.posts.length ?? 0,
      hashtags: data?.hashtags.length ?? 0,
    }),
    [data],
  );

  const nothingFound =
    Boolean(debounced) &&
    !isLoading &&
    counts.people + counts.companies + counts.posts + counts.hashtags === 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Search</h1>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-fg-faint"
        />
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="People, companies, posts or #topics"
          aria-label="Search InternLink"
          autoFocus
          className="h-12 w-full rounded-2xl border border-border-default bg-surface pr-4 pl-11 text-base placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
        />
      </div>

      <div
        role="tablist"
        aria-label="Search scope"
        className="mt-4 flex gap-1 rounded-xl bg-surface-sunken p-1"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={scope === tab.id}
            onClick={() => setScope(tab.id)}
            className={cn(
              'h-9 flex-1 cursor-pointer rounded-lg text-sm font-medium transition-colors duration-[160ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              scope === tab.id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!debounced && (
        <div className="panel mt-5">
          <EmptyState
            icon={<Compass />}
            title="Find your people"
            description="Search by name, company, school, or a #topic you care about."
          />
        </div>
      )}

      {isLoading && debounced && (
        <div className="mt-5 flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-20 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {nothingFound && (
        <div className="panel mt-5">
          <EmptyState
            icon={<Search />}
            title={`Nothing matched “${debounced}”`}
            description="Try a shorter term, a different spelling, or the person’s company or school."
          />
        </div>
      )}

      {data && counts.hashtags > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-fg-muted">Topics</h2>
          <ul className="flex flex-wrap gap-2">
            {data.hashtags.map((entry) => (
              <li key={entry.tag}>
                <Link
                  to={`/tag/${encodeURIComponent(entry.tag)}`}
                  className="flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-fg transition-colors hover:border-brand-border hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  <Hash aria-hidden="true" className="size-3.5 text-brand-fg" />
                  {entry.tag}
                  <span className="text-xs text-fg-subtle tabular-nums">
                    {compactCount(entry.postCount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && counts.people > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg-muted">
            <Users aria-hidden="true" className="size-4" />
            People
          </h2>
          <ul className="flex flex-col gap-2">
            {data.people.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </ul>
        </section>
      )}

      {data && counts.companies > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg-muted">
            <Building2 aria-hidden="true" className="size-4" />
            Companies
          </h2>
          <ul className="flex flex-col gap-2">
            {data.companies.map((company) => (
              <li key={company.id}>
                <Link
                  to={`/c/${company.id}`}
                  className="panel flex items-center gap-3 p-3 transition-colors hover:border-brand-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  <Avatar
                    name={company.name}
                    src={company.logoUrl}
                    size="md"
                    shape="rounded"
                    verified={company.isVerified}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-fg">
                      {company.name}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {[company.industry, company.headquarters].filter(Boolean).join(' · ') ||
                        'Company'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && counts.posts > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg-muted">
            <Compass aria-hidden="true" className="size-4" />
            Posts
          </h2>
          <ul className="flex flex-col gap-2">
            {data.posts.map((post) => (
              <li key={post.id}>
                <Link
                  to={`/p/${post.id}`}
                  className="panel block p-3.5 transition-colors hover:border-brand-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  <span className="flex items-center gap-2.5">
                    <Avatar
                      name={post.author.name}
                      src={post.author.avatarUrl}
                      size="xs"
                      shape={post.author.kind === 'company' ? 'rounded' : 'circle'}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">
                      {post.author.name}
                    </span>
                    <span className="shrink-0 text-2xs text-fg-faint">
                      {relativeTime(post.createdAt)}
                    </span>
                  </span>
                  <span className="mt-2 block line-clamp-3 text-sm text-fg-muted">
                    {post.body || 'Shared media'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}
