import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, MessageSquare, UserPlus, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Account, ConnectionRecord } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { messagingApi, networkApi, queryKeys } from '@/lib/api-endpoints';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

type Tab = 'connections' | 'requests';

/** FR-1006 — connections, and the requests waiting on you. */
export function NetworkScreen() {
  const [tab, setTab] = useState<Tab>('connections');
  const queryClient = useQueryClient();

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

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Network</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Connections can message you freely. Everyone else lands in your requests inbox first.
        </p>

        <div role="tablist" aria-label="Network" className="mt-4 flex gap-1 rounded-xl bg-surface-sunken p-1">
          {(
            [
              { id: 'connections', label: 'Connections', count: 0 },
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
                <span className="rounded-full bg-accent px-1.5 text-2xs font-bold text-white tabular-nums">
                  {entry.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {tab === 'requests' ? (
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
              {pending?.items.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  onRespond={(accept) => respond.mutate({ id: request.id, accept })}
                  isBusy={respond.isPending}
                />
              ))}
            </AnimatePresence>
          </ul>
        </>
      ) : (
        <>
          {loadingConnections && <div className="skeleton h-24 w-full rounded-2xl" />}

          {!loadingConnections && (connections?.items.length ?? 0) === 0 && (
            <div className="panel">
              <EmptyState
                icon={<Users />}
                title="No connections yet"
                description="Connect with people you have worked with, studied with, or met through a role."
              />
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {(connections?.items as Account[] | undefined)?.map((person) => (
              <ConnectionRow key={person.id} person={person} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RequestCard({
  request,
  onRespond,
  isBusy,
}: {
  request: ConnectionRecord;
  onRespond: (accept: boolean) => void;
  isBusy: boolean;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
      className="panel p-4"
    >
      <div className="flex items-start gap-3">
        <Avatar name={request.requesterId} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">Someone wants to connect</p>
          <p className="text-xs text-fg-subtle">{relativeTime(request.createdAt)}</p>
          {request.message && (
            <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-fg-muted">
              {request.message}
            </p>
          )}
        </div>
      </div>

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

function ConnectionRow({ person }: { person: Account }) {
  const navigate = useNavigate();

  const message = useMutation({
    mutationFn: () =>
      messagingApi.startThread({ recipientId: person.id, body: 'Hi — good to be connected.' }),
    onSuccess: (result) => navigate(`/messages/${result.thread.id}`),
    onError: () => toast.error('Could not open a conversation'),
  });

  return (
    <li className="panel flex items-center gap-3 p-3">
      <Avatar
        name={person.displayName}
        src={person.photoUrl}
        size="md"
        verified={person.verificationTiers.length > 0}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg">{person.displayName}</p>
        <p className="truncate text-xs text-fg-subtle capitalize">{person.activeRole}</p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={<MessageSquare />}
        isLoading={message.isPending}
        onClick={() => message.mutate()}
      >
        Message
      </Button>
    </li>
  );
}
