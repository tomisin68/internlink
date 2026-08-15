import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Check, Compass, Search, UserPlus, Users, X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button, LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { networkApi, queryKeys, type PendingRequest } from '@/lib/api-endpoints';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';
import { PersonRow } from './person-row';

type Tab = 'discover' | 'connections' | 'requests';

/** FR-1006 — finding people, your connections, and the requests waiting on you. */
export function NetworkScreen() {
  const [tab, setTab] = useState<Tab>('discover');
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const { data: people, isLoading: loadingPeople } = useQuery({
    queryKey: queryKeys.people('suggested', search),
    queryFn: () => networkApi.people('suggested', search),
    enabled: tab === 'discover',
  });

  const { data: connections, isLoading: loadingConnections } = useQuery({
    queryKey: queryKeys.connections,
    queryFn: networkApi.connections,
  });

  const { data: pending, isLoading: loadingPending } = useQuery({
    queryKey: queryKeys.pendingConnections,
    queryFn: networkApi.pending,
  });

  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      networkApi.respond(id, accept),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['network'] });
      toast.success(variables.accept ? 'Connected' : 'Request declined');
    },
    onError: (error) => {
      toast.error(
        'Could not respond',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  const pendingCount = pending?.items.length ?? 0;
  const connectionCount = connections?.items.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Network</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Connect to message freely, or follow to see someone&rsquo;s posts without asking.
        </p>

        <div role="tablist" aria-label="Network" className="mt-4 flex gap-1 rounded-xl bg-surface-sunken p-1">
          {(
            [
              { id: 'discover', label: 'Discover', count: 0 },
              { id: 'connections', label: 'Connections', count: connectionCount },
              { id: 'requests', label: 'Requests', count: pendingCount },
            ] as const
          ).map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                'flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors duration-[160ms]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                tab === entry.id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
              )}
            >
              {entry.label}
              {entry.count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-2xs font-bold tabular-nums',
                    entry.id === 'requests'
                      ? 'bg-accent text-white'
                      : 'bg-border-default text-fg-muted',
                  )}
                >
                  {entry.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {tab === 'discover' && (
        <>
          <div className="relative mb-4">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people by name, headline or company"
              aria-label="Search people"
              className="h-11 w-full rounded-xl border border-border-default bg-surface pr-3 pl-9 text-sm placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
            />
          </div>

          {loadingPeople && (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-20 w-full rounded-2xl" />
              ))}
            </div>
          )}

          {!loadingPeople && (people?.items.length ?? 0) === 0 && (
            <div className="panel">
              <EmptyState
                icon={<Compass />}
                title={search ? 'Nobody matched that' : 'No suggestions yet'}
                description={
                  search
                    ? 'This list only covers people we would suggest to you. Search across everyone instead.'
                    : 'As more people join, you will find them here.'
                }
                action={
                  search ? (
                    <LinkButton
                      to={`/search?q=${encodeURIComponent(search)}`}
                      size="sm"
                      variant="outline"
                    >
                      Search everyone
                    </LinkButton>
                  ) : undefined
                }
              />
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {people?.items.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </ul>
        </>
      )}

      {tab === 'requests' && (
        <>
          {loadingPending && <div className="skeleton h-24 w-full rounded-2xl" />}

          {!loadingPending && pendingCount === 0 && (
            <div className="panel">
              <EmptyState
                icon={<UserPlus />}
                title="No pending requests"
                description="When someone asks to connect, you will find them here."
              />
            </div>
          )}

          <ul className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {pending?.items.map((entry) => (
                <RequestCard
                  key={entry.request.id}
                  entry={entry}
                  onRespond={(accept) => respond.mutate({ id: entry.request.id, accept })}
                  isBusy={respond.isPending}
                />
              ))}
            </AnimatePresence>
          </ul>
        </>
      )}

      {tab === 'connections' && (
        <>
          {loadingConnections && <div className="skeleton h-24 w-full rounded-2xl" />}

          {!loadingConnections && connectionCount === 0 && (
            <div className="panel">
              <EmptyState
                icon={<Users />}
                title="No connections yet"
                description="Connect with people you have worked with, studied with, or met through a role."
                action={
                  <Button size="sm" variant="outline" onClick={() => setTab('discover')}>
                    Find people
                  </Button>
                }
              />
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {connections?.items.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RequestCard({
  entry,
  onRespond,
  isBusy,
}: {
  entry: PendingRequest;
  onRespond: (accept: boolean) => void;
  isBusy: boolean;
}) {
  const { request, person } = entry;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
      className="panel p-4"
    >
      <Link
        to={`/u/${person.id}`}
        className="group flex items-start gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <Avatar
          name={person.displayName}
          src={person.photoUrl}
          size="md"
          verified={person.isVerified}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg group-hover:underline">
            {person.displayName}
          </p>
          {person.headline && (
            <p className="truncate text-xs text-fg-subtle">{person.headline}</p>
          )}
          <p className="mt-0.5 text-2xs text-fg-faint">
            {relativeTime(request.createdAt)}
            {person.mutualConnections > 0 &&
              ` · ${person.mutualConnections} mutual ${person.mutualConnections === 1 ? 'connection' : 'connections'}`}
          </p>
        </div>
      </Link>

      {request.message && (
        <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-fg-muted">
          {request.message}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" leftIcon={<Check />} disabled={isBusy} onClick={() => onRespond(true)}>
          Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<X />}
          disabled={isBusy}
          onClick={() => onRespond(false)}
        >
          Decline
        </Button>
      </div>
    </motion.li>
  );
}
