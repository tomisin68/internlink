import { useState } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Inbox, MailQuestion } from 'lucide-react';
import type { Thread } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { messagingApi, queryKeys } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { useRealtimeThreads } from './use-realtime';

type Box = 'primary' | 'requests';

/**
 * FR-506 — two inboxes, not one list with a filter.
 *
 * Two-pane on desktop, stacked on mobile: on a phone the list and the thread
 * are separate routes, so the back button works the way people expect rather
 * than closing a panel.
 */
export function MessagesScreen() {
  const [box, setBox] = useState<Box>('primary');
  const { threadId } = useParams();
  const { account } = useSession();

  const { data: threads, isLoading } = useQuery({
    queryKey: queryKeys.threads(box),
    queryFn: () => messagingApi.listThreads(box),
    // Safety net only — the realtime subscription below is the live path.
    refetchInterval: 60_000,
  });

  const { data: summary } = useQuery({
    queryKey: queryKeys.inboxSummary,
    queryFn: messagingApi.summary,
  });

  // One subscription feeds both inboxes and the unread badge.
  useRealtimeThreads(account?.id);

  return (
    <div className="lg:grid lg:grid-cols-[20rem_1fr] lg:gap-0">
      {/* ------------------------------------------------------ the list -- */}
      <section
        className={cn(
          'border-border-subtle lg:border-r',
          // On mobile the list hides entirely once a thread is open — the
          // thread is a full screen, not a panel over a list.
          threadId ? 'hidden lg:block' : 'block',
        )}
        aria-label="Conversations"
      >
        <header className="border-b border-border-subtle bg-surface px-4 py-3">
          <h1 className="mb-3 text-lg font-bold tracking-tight">Messages</h1>

          <div
            role="tablist"
            aria-label="Inbox"
            className="flex gap-1 rounded-xl bg-surface-sunken p-1"
          >
            {(
              [
                { id: 'primary', label: 'Inbox', count: summary?.unreadThreads ?? 0 },
                { id: 'requests', label: 'Requests', count: summary?.pendingRequests ?? 0 },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={box === tab.id}
                onClick={() => setBox(tab.id)}
                className={cn(
                  'flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors duration-[160ms]',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  box === tab.id
                    ? 'bg-surface text-fg shadow-xs'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="rounded-full bg-accent px-1.5 text-2xs font-bold text-white tabular-nums">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </header>

        <div className="lg:h-[calc(100dvh-11rem)] lg:overflow-y-auto">
          {isLoading && (
            <div className="flex flex-col gap-3 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-16 w-full" />
              ))}
            </div>
          )}

          {!isLoading && threads?.items.length === 0 && (
            <EmptyState
              icon={box === 'requests' ? <MailQuestion /> : <Inbox />}
              title={box === 'requests' ? 'No message requests' : 'No conversations yet'}
              description={
                box === 'requests'
                  ? 'People who are not connected to you land here first, so your inbox stays yours.'
                  : 'Apply to a role or connect with someone, and your conversations will show up here.'
              }
            />
          )}

          <ul>
            {threads?.items.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                accountId={account?.id ?? ''}
                isActive={thread.id === threadId}
              />
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------------------------------------------- the thread -- */}
      <section className={cn(threadId ? 'block' : 'hidden lg:block')} aria-label="Conversation">
        <Outlet />
      </section>
    </div>
  );
}

function ThreadRow({
  thread,
  accountId,
  isActive,
}: {
  thread: Thread;
  accountId: string;
  isActive: boolean;
}) {
  const other = thread.participants.find((p) => p.accountId !== accountId);
  const unread = thread.unread[accountId] ?? 0;

  return (
    <li>
      <NavLink
        to={`/messages/${thread.id}`}
        className={cn(
          'flex items-start gap-3 border-b border-border-subtle px-4 py-3 transition-colors duration-[160ms]',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]',
          isActive ? 'bg-brand-subtle' : 'hover:bg-surface-sunken',
        )}
      >
        <Avatar name={other?.name ?? 'Unknown'} src={other?.avatarUrl} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p
              className={cn(
                'truncate text-sm',
                unread > 0 ? 'font-bold text-fg' : 'font-medium text-fg',
              )}
            >
              {other?.name ?? 'Unknown'}
            </p>
            {thread.lastMessage && (
              <span className="ml-auto shrink-0 text-2xs text-fg-faint">
                {relativeTime(thread.lastMessage.sentAt)}
              </span>
            )}
          </div>

          <p
            className={cn(
              'mt-0.5 truncate text-sm',
              unread > 0 ? 'font-medium text-fg-muted' : 'text-fg-subtle',
            )}
          >
            {thread.lastMessage
              ? `${thread.lastMessage.senderId === accountId ? 'You: ' : ''}${thread.lastMessage.body}`
              : 'No messages yet'}
          </p>
        </div>

        {unread > 0 && (
          <span
            className="mt-1 min-w-5 shrink-0 rounded-full bg-brand px-1.5 py-0.5 text-center text-2xs font-bold text-white tabular-nums"
            aria-label={`${unread} unread`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </NavLink>
    </li>
  );
}
