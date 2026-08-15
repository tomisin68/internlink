import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Briefcase, MapPin, Plus, Search, SlidersHorizontal, Timer, X } from 'lucide-react';
import type { Listing, WorkMode } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button, LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { listingsApi, queryKeys, type ListingFilters } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { SKILL_SUGGESTIONS, WORK_MODE_OPTIONS } from '@/features/profile/constants';

/**
 * FR-203 — browse and filter listings.
 *
 * Doubles as the recruiter's own board: same card, different source. The two
 * were nearly identical screens, and one component with a `mine` branch is a
 * lot less to keep in step than two that drift.
 */
export function RolesScreen({ mine = false }: { mine?: boolean }) {
  const { account } = useSession();
  const [filters, setFilters] = useState<ListingFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');

  const isRecruiter = account?.activeRole === 'recruiter';
  const showMine = mine || isRecruiter;

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const { data, isLoading } = useQuery({
    queryKey: showMine ? queryKeys.myListings : queryKeys.listings(filterKey),
    queryFn: () => (showMine ? listingsApi.mine() : listingsApi.browse(filters)),
  });

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {showMine ? 'Your roles' : 'Find a role'}
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            {showMine
              ? 'Everything you have posted, drafts included.'
              : 'Every open internship and entry-level role on InternLink.'}
          </p>
        </div>

        {isRecruiter && (
          <LinkButton to="/roles/new" size="sm" leftIcon={<Plus />}>
            Post a role
          </LinkButton>
        )}
      </header>

      {!showMine && (
        <div className="mb-5 flex flex-col gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFilters((f) => ({ ...f, q: searchDraft.trim() }));
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-fg-faint"
              />
              <input
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search roles or skills…"
                aria-label="Search roles"
                className="h-11 w-full rounded-xl border border-border-default bg-surface pr-3.5 pl-10.5 text-base placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowFilters((v) => !v)}
              leftIcon={<SlidersHorizontal />}
              aria-expanded={showFilters}
            >
              {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
            </Button>
          </form>

          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="panel overflow-hidden p-4"
            >
              <fieldset className="mb-4">
                <legend className="mb-2 text-sm font-medium text-fg">How you want to work</legend>
                <div className="flex flex-wrap gap-2">
                  {WORK_MODE_OPTIONS.map((option) => (
                    <FilterChip
                      key={option.value}
                      active={filters.workMode === option.value}
                      onClick={() =>
                        setFilters((f) => ({
                          ...f,
                          workMode: f.workMode === option.value ? '' : (option.value as WorkMode),
                        }))
                      }
                    >
                      {option.title}
                    </FilterChip>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-fg">Skill</legend>
                <div className="flex flex-wrap gap-2">
                  {SKILL_SUGGESTIONS.slice(0, 10).map((skill) => (
                    <FilterChip
                      key={skill}
                      active={filters.skill === skill}
                      onClick={() =>
                        setFilters((f) => ({ ...f, skill: f.skill === skill ? '' : skill }))
                      }
                    >
                      {skill}
                    </FilterChip>
                  ))}
                </div>
              </fieldset>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFilters({});
                    setSearchDraft('');
                  }}
                  className="mt-4 flex cursor-pointer items-center gap-1 text-sm font-medium text-brand-fg underline-offset-4 hover:underline"
                >
                  <X aria-hidden="true" className="size-3.5" />
                  Clear all
                </button>
              )}
            </motion.div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-32 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && data?.items.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Briefcase />}
            title={showMine ? 'No roles yet' : 'Nothing matches that'}
            description={
              showMine
                ? 'Post your first role and it will show up here, draft or live.'
                : 'Try removing a filter or widening your search.'
            }
            action={
              isRecruiter ? (
                <LinkButton to="/roles/new" variant="secondary" leftIcon={<Plus />}>
                  Post a role
                </LinkButton>
              ) : undefined
            }
          />
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {data?.items.map((listing, index) => (
          <RoleCard key={listing.id} listing={listing} index={index} showStatus={showMine} />
        ))}
      </ul>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-[160ms]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        active
          ? 'border-brand bg-brand-subtle text-brand-fg'
          : 'border-border-default text-fg-muted hover:border-brand-border hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success-subtle text-success-fg',
  draft: 'bg-surface-sunken text-fg-muted',
  paused: 'bg-warning-subtle text-warning-fg',
  closed: 'bg-danger-subtle text-danger-fg',
};

function RoleCard({
  listing,
  index,
  showStatus,
}: {
  listing: Listing;
  index: number;
  showStatus: boolean;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: Math.min(index * 0.03, 0.15) }}
    >
      <Link
        to={`/roles/${listing.id}`}
        className="panel block p-4 transition-colors hover:border-brand-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <div className="flex items-start gap-3">
          <Avatar name={listing.title} size="md" shape="rounded" />

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-base leading-snug font-semibold text-fg">
                {listing.title}
              </h2>
              {showStatus && (
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold capitalize',
                    STATUS_STYLE[listing.status] ?? STATUS_STYLE.draft,
                  )}
                >
                  {listing.status}
                </span>
              )}
            </div>

            <ul className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
              <li className="flex items-center gap-1">
                <MapPin aria-hidden="true" className="size-3.5" />
                {listing.workMode === 'remote'
                  ? 'Remote'
                  : (listing.location ?? 'Location not stated')}
              </li>
              {listing.durationMonths && (
                <li className="flex items-center gap-1">
                  <Timer aria-hidden="true" className="size-3.5" />
                  {listing.durationMonths} months
                </li>
              )}
              {listing.publishedAt && <li>Posted {relativeTime(listing.publishedAt)}</li>}
              {listing.applicationCount > 0 && (
                <li>
                  {listing.applicationCount} applicant
                  {listing.applicationCount === 1 ? '' : 's'}
                </li>
              )}
            </ul>

            {listing.skills.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {listing.skills.slice(0, 5).map((skill) => (
                  <li
                    key={skill}
                    className="rounded-lg bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand-fg"
                  >
                    {skill}
                  </li>
                ))}
                {listing.skills.length > 5 && (
                  <li className="px-1 py-0.5 text-xs text-fg-faint">
                    +{listing.skills.length - 5}
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </Link>
    </motion.li>
  );
}
