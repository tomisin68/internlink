import { Fragment, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AtSign,
  BadgeCheck,
  Bell,
  CalendarClock,
  CheckCheck,
  Compass,
  Eye,
  Heart,
  MessageCircle,
  MessageSquare,
  Repeat2,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import type { NotificationView } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { longRelativeTime, timeBucket } from '@/lib/format';
import { api } from '@/lib/api-client';
import { toast } from '@/lib/stores';

export const notificationsApi = {
  list: () =>
    api.get<{ items: NotificationView[]; unreadCount: number }>('/notifications?limit=30'),
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
 * `title` is a function of the actor rather than a fixed string, because the
 * first version of this screen said "Someone reacted to your post" for
 * everything — a notification without a name tells you an event happened and
 * nothing about whether it matters. The server resolves the actor and a preview
 * of the target (see `presentation.service`); this turns them into a sentence.
 *
 * Written as a lookup rather than a switch so an unhandled type degrades to a
 * readable fallback instead of an empty row — new event types get added to
 * `events.ts` faster than they get UI.
 */
interface Preset {
  icon: typeof Bell;
  title: (actor: string, payload: Record<string, unknown>) => string;
  /** Second line. Usually the post body or the comment itself. */
  body?: (target: NotificationView['target'], payload: Record<string, unknown>) => string | null;
  href: (payload: Record<string, unknown>) => string;
}

const quoted = (text: string | null | undefined): string | null =>
  text && text.trim() ? `“${text.trim()}”` : null;

const PRESENTATION: Record<string, Preset> = {
  message_received: {
    icon: MessageSquare,
    title: (actor) => `${actor} sent you a message`,
    body: (target) => quoted(target?.preview),
    href: (p) => `/messages/${p.threadId as string}`,
  },
  message_request: {
    icon: MessageSquare,
    title: (actor) => `${actor} sent a message request`,
    href: (p) => `/messages/${p.threadId as string}`,
  },
  connection_request: {
    icon: UserPlus,
    title: (actor) => `${actor} wants to connect`,
    href: () => '/network',
  },
  connection_accepted: {
    icon: UserPlus,
    title: (actor) => `${actor} accepted your connection request`,
    href: () => '/network',
  },
  application_status_changed: {
    icon: CalendarClock,
    title: () => 'An application moved forward',
    href: () => '/applications',
  },
  application_received: {
    icon: Sparkles,
    title: (actor) => `${actor} applied to your role`,
    body: (target) => target?.preview || null,
    href: (p) =>
      p.listingId ? `/roles/${p.listingId as string}/pipeline` : '/applications',
  },
  interview_scheduled: {
    icon: CalendarClock,
    title: () => 'Interview scheduled',
    href: () => '/applications',
  },
  post_reaction: {
    icon: Heart,
    title: (actor) => `${actor} liked your post`,
    body: (target) => target?.preview || null,
    href: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
  },
  post_comment: {
    icon: MessageCircle,
    title: (actor, p) =>
      p.isReply ? `${actor} replied to your comment` : `${actor} commented on your post`,
    body: (target) => quoted(target?.preview),
    href: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
  },
  post_reshare: {
    icon: Repeat2,
    title: (actor) => `${actor} reshared your post`,
    body: (target) => target?.preview || null,
    href: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
  },
  comment_reaction: {
    icon: Heart,
    title: (actor) => `${actor} liked your comment`,
    body: (target) => quoted(target?.preview),
    href: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
  },
  mention: {
    icon: AtSign,
    title: (actor, p) => `${actor} tagged you in a ${p.commentId ? 'comment' : 'post'}`,
    body: (target) => quoted(target?.preview),
    href: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
  },
  new_follower: {
    icon: UserPlus,
    title: (actor) => `${actor} started following you`,
    body: () => 'Follow them back to see their posts.',
    href: (p) => (p.byAccountId ? `/u/${p.byAccountId as string}` : '/network'),
  },
  follow_back: {
    icon: UserPlus,
    title: (actor) => `${actor} followed you back`,
    href: (p) => (p.byAccountId ? `/u/${p.byAccountId as string}` : '/network'),
  },
  profile_view: {
    icon: Eye,
    title: (actor) => `${actor} viewed your profile`,
    href: (p) => (p.byAccountId ? `/u/${p.byAccountId as string}` : '/profile'),
  },
  new_post_from_following: {
    icon: Compass,
    title: (actor) => `${actor} posted`,
    body: (target) => target?.preview || null,
    href: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
  },
  reengagement: {
    icon: Sparkles,
    title: () => 'You have missed a few things',
    href: () => '/feed',
  },
  company_verified: {
    icon: BadgeCheck,
    title: () => 'Your company is verified',
    href: () => '/profile',
  },
  listing_match: {
    icon: Sparkles,
    title: () => 'A new role matches you',
    body: (target) => target?.preview || null,
    href: () => '/matches',
  },
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

  /**
   * Rows grouped under "Today", "Yesterday", "This week"…
   *
   * The question people open this screen with is "what happened since I last
   * looked", and a date header answers it without reading a single row.
   */
  const groups = useMemo(() => {
    const buckets: Array<{ label: string; items: NotificationView[] }> = [];
    for (const item of data?.items ?? []) {
      const label = timeBucket(item.createdAt);
      const last = buckets[buckets.length - 1];
      if (last?.label === label) last.items.push(item);
      else buckets.push({ label, items: [item] });
    }
    return buckets;
  }, [data]);

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

      {groups.map((group) => (
        <Fragment key={group.label}>
          <h2 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase first:mt-0">
            {group.label}
          </h2>

          <ul className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {group.items.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onRead={() => markOne.mutate(notification.id)}
                />
              ))}
            </AnimatePresence>
          </ul>
        </Fragment>
      ))}
    </div>
  );
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: NotificationView;
  onRead: () => void;
}) {
  const preset = PRESENTATION[notification.type];
  const Icon = preset?.icon ?? Bell;
  const actorName = notification.actor?.displayName ?? 'Someone';
  const title = preset ? preset.title(actorName, notification.payload) : 'Update';
  const body = preset?.body?.(notification.target, notification.payload) ?? null;
  const href = preset?.href(notification.payload) ?? '/home';
  const isUnread = !notification.readAt;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
    >
      <Link
        to={href}
        onClick={() => isUnread && onRead()}
        className={cn(
          'flex items-start gap-3 rounded-xl border p-3.5 transition-colors duration-[160ms]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
          isUnread
            ? 'border-brand-border bg-brand-subtle hover:bg-brand-subtle-hover'
            : 'border-border-subtle bg-surface hover:bg-surface-sunken',
        )}
      >
        {/* The actor's face where there is one; the event icon otherwise. A
            photo is what makes a list of notifications scannable. */}
        <span className="relative shrink-0">
          {notification.actor ? (
            <Avatar
              name={notification.actor.displayName}
              src={notification.actor.photoUrl}
              size="sm"
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                'flex size-9 items-center justify-center rounded-lg',
                isUnread ? 'bg-brand text-white' : 'bg-surface-sunken text-fg-muted',
              )}
            >
              <Icon className="size-4.5" />
            </span>
          )}

          {notification.actor && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full ring-2 ring-[var(--bg-surface)]',
                isUnread ? 'bg-brand text-white' : 'bg-surface-sunken text-fg-muted',
              )}
            >
              <Icon className="size-3" />
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block text-sm',
              isUnread ? 'font-semibold text-fg' : 'font-medium text-fg-muted',
            )}
          >
            {title}
          </span>

          {body && (
            <span className="mt-0.5 block line-clamp-2 text-sm text-fg-subtle">{body}</span>
          )}

          <span className="mt-0.5 block text-xs text-fg-faint">
            {longRelativeTime(notification.createdAt)}
          </span>
        </span>

        {/* A photo from the post, so "which post" is answered at a glance. */}
        {notification.target?.mediaUrl && (
          <img
            src={notification.target.mediaUrl}
            alt=""
            loading="lazy"
            className="size-11 shrink-0 rounded-lg border border-border-subtle object-cover"
          />
        )}

        {isUnread && (
          <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
        )}
      </Link>
    </motion.li>
  );
}
