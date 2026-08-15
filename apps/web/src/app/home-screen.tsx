import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Compass, MessageSquare, Search, Sparkles, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { ProgressRing } from '@/components/ui/stepper';
import { useSession } from '@/features/auth/use-auth';
import { feedApi, listingsApi, messagingApi, profileApiClient, queryKeys } from '@/lib/api-endpoints';

/**
 * The landing screen inside the shell.
 *
 * Chrome (logo, role switcher, sign-out, nav) lives in AppShell — this renders
 * content only, or the header would appear twice.
 */
export function HomeScreen() {
  const { account, internProfile, company } = useSession();
  const isIntern = account?.activeRole === 'intern';

  const { data: summary } = useQuery({
    queryKey: queryKeys.inboxSummary,
    queryFn: messagingApi.summary,
  });

  const { data: matches } = useQuery({
    queryKey: queryKeys.matches,
    queryFn: () => feedApi.getMatches(3),
    enabled: isIntern,
  });

  // The network and roles tiles used to be hardcoded zeroes, which made the
  // whole row read as broken — a stat card that never moves is worse than no
  // stat card, because it looks like the product is not counting.
  const { data: stats } = useQuery({
    queryKey: queryKeys.profileStats,
    queryFn: profileApiClient.myStats,
    enabled: Boolean(account),
  });

  const { data: myRoles } = useQuery({
    queryKey: queryKeys.myListings,
    queryFn: listingsApi.mine,
    enabled: Boolean(account) && !isIntern,
  });

  if (!account) return null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Hello, {account.firstName}.
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            {isIntern
              ? 'Here is what is waiting for you today.'
              : `Signed in for ${company?.name ?? 'your company'}.`}
          </p>
        </div>

        {isIntern && internProfile && (
          <Link
            to="/profile"
            className="flex items-center gap-3 rounded-2xl border border-border-default bg-surface p-3 transition-colors hover:border-brand-border hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <ProgressRing value={internProfile.completeness} size={44} strokeWidth={4} />
            <span className="pr-1 text-sm">
              <span className="block font-semibold text-fg">Profile strength</span>
              <span className="text-fg-subtle">
                {internProfile.completeness >= 80 ? 'Looking sharp' : 'Add more to rank higher'}
              </span>
            </span>
          </Link>
        )}
      </header>

      {/* --------------------------------------------------- quick stats -- */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <StatCard
          to="/messages"
          icon={<MessageSquare />}
          label="Unread"
          value={summary?.unreadThreads ?? 0}
          hint={
            (summary?.pendingRequests ?? 0) > 0
              ? `${summary?.pendingRequests} request${summary?.pendingRequests === 1 ? '' : 's'}`
              : 'conversations'
          }
        />
        {isIntern ? (
          <StatCard
            to="/matches"
            icon={<Sparkles />}
            label="Matches"
            value={matches?.items.length ?? 0}
            hint="roles for you"
          />
        ) : (
          <StatCard
            to="/roles"
            icon={<Briefcase />}
            label="Roles"
            value={myRoles?.items.length ?? 0}
            hint="posted"
          />
        )}
        <StatCard
          to="/network"
          icon={<Users />}
          label="Network"
          value={stats?.connections ?? 0}
          hint={
            (stats?.followers ?? 0) > 0
              ? `${stats?.followers} follower${stats?.followers === 1 ? '' : 's'}`
              : 'connections'
          }
        />
      </div>

      {/* ------------------------------------------------------ top match -- */}
      {isIntern && matches && matches.items.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Your strongest match</h2>
            <Link
              to="/matches"
              className="text-sm font-medium text-brand-fg underline-offset-4 hover:underline"
            >
              See all
            </Link>
          </div>

          <Link to="/matches" className="panel block p-4 transition-colors hover:border-brand-border">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-fg">{matches.items[0]!.listing.title}</p>
                <p className="mt-0.5 text-sm text-fg-muted">
                  {matches.items[0]!.company?.name ?? 'Unknown company'}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-success-subtle px-2.5 py-1 text-sm font-bold text-success-fg tabular-nums">
                {matches.items[0]!.score}%
              </span>
            </div>
            {matches.items[0]!.highlights[0] && (
              <p className="mt-2 text-sm text-fg-muted">{matches.items[0]!.highlights[0]}</p>
            )}
          </Link>
        </section>
      )}

      {isIntern && matches && matches.profileReady && matches.items.length === 0 && (
        <div className="panel mt-8">
          <EmptyState
            icon={<Compass />}
            title="No strong matches yet"
            description="Nothing currently posted clears the relevance bar. Try broadening your work-mode preferences."
            action={
              <Button variant="secondary" leftIcon={<Search />} disabled title="Coming next">
                Browse all roles
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

function StatCard({
  to,
  icon,
  label,
  value,
  hint,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="panel flex items-center gap-3 p-3.5 transition-colors hover:border-brand-border hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand-fg [&>svg]:size-5"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-bold text-fg tabular-nums">{value}</span>
        <span className="block truncate text-xs text-fg-subtle">
          {label} · {hint}
        </span>
      </span>
    </Link>
  );
}
