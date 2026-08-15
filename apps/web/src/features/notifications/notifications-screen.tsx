import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck,
  Bell,
  CalendarClock,
  CheckCheck,
  Heart,
  MessageCircle,
  MessageSquare,
  Repeat2,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { api } from '@/lib/api-client';
import { toast } from '@/lib/stores';

export interface NotificationRecord {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  urgent: boolean;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: () =>
    api.get<{ items: NotificationRecord[]; unreadCount: number }>('/notifications?limit=30'),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => api.post<{ readAt: string }>(`/notifications/${id}/read`),
  markAllRead: () => api.post<{ marked: number }>('/notifications/read-all'),
  clearRead: () => api.delete<{ deleted: number }>('/notifications/read'),
};

export const notificationKeys = {
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
};

/**
 * Copy and destination per event type.
 *
 * Written as a lookup rather than a switch inside the component so an unhandled
 * type degrades to a readable fallback instead of rendering an empty row — new
 * event types get added to `events.ts` faster than they get UI.
 */
const PRESENTATION: Record<
  string,
  { icon: typeof Bell; title: string; href: (p: Record<string, unknown>) => string }
> = {
  message_received: {
    icon: MessageSquare,
    title: 'New message',
    href: (p) => `/messages/${p.threadId as string}`,
  },
  message_request: {
    icon: MessageSquare,
    title: 'New message request',
    href: (p) => `/messages/${p.threadId as string}`,
  },
  connection_request: { icon: UserPlus, title: 'Someone wants to connect', href: () => '/network' },
  connection_accepted: {
    icon: UserPlus,
    title: 'Your connection request was accepted',
    href: () => '/network',
  },
  application_status_changed: {
    icon: CalendarClock,
    title: 'An application moved forward',
    href: () => '/applications',
  },
  application_received: {
    icon: Sparkles,
    title: 'New applicant',
    href: (p) => `/roles/${p.listingId as string}/pipeline`,
  },
  interview_scheduled: {
    icon: CalendarClock,
    title: 'Interview scheduled',
    href: () => '/applications',
  },
  post_reaction: {
    icon: Heart,
    title: 'Someone reacted to your post',
    href: () => '/feed',
  },
  post_comment: {
    icon: MessageCircle,
    title: 'New comment on your post',
    href: () => '/feed',
  },
  post_reshare: {
    icon: Repeat2,
    title: 'Someone reshared your post',
    href: () => '/feed',
  },
  comment_reaction: {
    icon: Heart,
    title: 'Someone liked your comment',
    href: () => '/feed',
  },
  new_follower: {
    icon: UserPlus,
    title: 'You have a new follower',
    href: (p) => (p.byAccountId ? `/u/${p.byAccountId as string}` : '/network'),
  },
  company_verified: {
    icon: BadgeCheck,
    title: 'Your company is verified',
    href: () => '/profile',
  },
  listing_match: { icon: Sparkles, title: 'A new role matches you', href: () => '/matches' },
};

export function NotificationsScreen() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: notificationKeys.list,
    queryFn: notificationsApi.list,
  });

  const markAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(result.marked > 0 ? 'All caught up' : 'Nothing to mark');
    },
  });

  const markOne = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = data?.unreadCount ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            {unread > 0 ? `${unread} unread` : 'You are all caught up.'}
          </p>
        </div>

        {unread > 0 && (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<CheckCheck />}
            isLoading={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all read
          </Button>
        )}
      </header>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && data?.items.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Bell />}
            title="Nothing yet"
            description="Messages, connection requests and application updates will land here."
          />
        </div>
      )}

      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {data?.items.map((notification) => {
            const preset = PRESENTATION[notification.type];
            const Icon = preset?.icon ?? Bell;
            const href = preset?.href(notification.payload) ?? '/home';
            const isUnread = !notification.readAt;

            return (
              <motion.li
                key={notification.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
              >
                <Link
                  to={href}
                  onClick={() => isUnread && markOne.mutate(notification.id)}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3.5 transition-colors duration-[160ms]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                    isUnread
                      ? 'border-brand-border bg-brand-subtle hover:bg-brand-subtle-hover'
                      : 'border-border-subtle bg-surface hover:bg-surface-sunken',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg',
                      isUnread ? 'bg-brand text-white' : 'bg-surface-sunken text-fg-muted',
                    )}
                  >
                    <Icon className="size-4.5" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm',
                        isUnread ? 'font-semibold text-fg' : 'font-medium text-fg-muted',
                      )}
                    >
                      {preset?.title ?? 'Update'}
                    </span>
                    <span className="mt-0.5 block text-xs text-fg-subtle">
                      {relativeTime(notification.createdAt)}
                    </span>
                  </span>

                  {isUnread && (
                    <span
                      aria-label="Unread"
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                    />
                  )}
                </Link>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
