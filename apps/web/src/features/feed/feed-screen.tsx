import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Building2,
  Compass,
  Heart,
  MessageCircle,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import type { FeedItem, FeedReason } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { compactCount, relativeTime } from '@/lib/format';
import { feedApi, queryKeys } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

/**
 * The "why am I seeing this" label.
 *
 * The ranker already computes a reason per item (see ranking.ts). Showing it
 * is what stops a ranked feed reading as arbitrary — and it is the difference
 * between a feed people trust and one they assume is manipulating them.
 */
const REASON_LABEL: Record<FeedReason, { text: string; icon: typeof Users }> = {
  connection: { text: 'From your network', icon: Users },
  following_company: { text: 'A company you follow', icon: Building2 },
  second_degree: { text: 'Someone your connections know', icon: Users },
  same_school: { text: 'From your school', icon: Sparkles },
  popular: { text: 'Popular on InternLink', icon: Compass },
  your_post: { text: 'Your post', icon: Sparkles },
};

export function FeedScreen() {
  const [scope, setScope] = useState<'for_you' | 'following'>('for_you');
  const { account } = useSession();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.feed(scope),
    queryFn: () => feedApi.getFeed(scope),
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Feed</h1>
        <div
          role="tablist"
          aria-label="Feed scope"
          className="mt-3 flex gap-1 rounded-xl bg-surface-sunken p-1"
        >
          {(
            [
              { id: 'for_you', label: 'For you' },
              { id: 'following', label: 'Following' },
            ] as const
          ).map((tab) => (
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
      </header>

      <Composer />

      {isLoading && (
        <div className="mt-5 flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-40 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && data?.items.length === 0 && (
        <div className="panel mt-5">
          <EmptyState
            icon={<Compass />}
            title={scope === 'following' ? 'Nothing from your network yet' : 'Your feed is empty'}
            description={
              scope === 'following'
                ? 'Connect with people and follow companies, and their updates will appear here.'
                : 'Be the first to post something — or connect with a few people to fill this out.'
            }
          />
        </div>
      )}

      <ul className="mt-5 flex flex-col gap-4">
        <AnimatePresence initial={false}>
          {data?.items.map((item) => (
            <PostCard key={item.post.id} item={item} viewerId={account?.id ?? ''} scope={scope} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function Composer() {
  const [body, setBody] = useState('');
  const [asCompany, setAsCompany] = useState(false);
  const { account, company } = useSession();
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () =>
      feedApi.createPost({ kind: 'update', body: body.trim(), tags: [], asCompany }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast.success('Posted');
    },
    onError: (error) => {
      toast.error(
        'Could not post',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  if (!account) return null;
  const canPostAsCompany = account.activeRole === 'recruiter' && Boolean(company);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim() && !create.isPending) create.mutate();
      }}
      className="panel p-4"
    >
      <div className="flex gap-3">
        <Avatar
          name={asCompany && company ? company.name : account.displayName}
          src={asCompany && company ? company.logoUrl : account.photoUrl}
          size="sm"
          shape={asCompany ? 'rounded' : 'circle'}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={3000}
          placeholder="Share an update, a project, or something you just learned…"
          aria-label="Write a post"
          className="min-h-11 flex-1 resize-none bg-transparent py-2 text-base placeholder:text-fg-faint focus:outline-none"
        />
      </div>

      <div className="mt-3 flex items-center gap-3 border-t border-border-subtle pt-3">
        {canPostAsCompany && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={asCompany}
              onChange={(e) => setAsCompany(e.target.checked)}
              className="size-4 cursor-pointer accent-[var(--brand)]"
            />
            Post as {company?.name}
          </label>
        )}

        <span className="ml-auto text-xs text-fg-faint tabular-nums">{body.length}/3000</span>

        <Button
          type="submit"
          size="sm"
          disabled={!body.trim()}
          isLoading={create.isPending}
          rightIcon={<Send />}
        >
          Post
        </Button>
      </div>
    </form>
  );
}

function PostCard({
  item,
  viewerId,
  scope,
}: {
  item: FeedItem;
  viewerId: string;
  scope: 'for_you' | 'following';
}) {
  const queryClient = useQueryClient();
  const reason = REASON_LABEL[item.reason];
  const ReasonIcon = reason.icon;

  // Optimistic: a like that waits on a round trip feels broken. The rollback
  // in onError puts it back if the write actually failed.
  const react = useMutation({
    mutationFn: () => feedApi.toggleReaction(item.post.id),
    onMutate: async () => {
      const key = queryKeys.feed(scope);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ items: FeedItem[] }>(key);

      queryClient.setQueryData<{ items: FeedItem[] }>(key, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((i) =>
                i.post.id === item.post.id
                  ? {
                      ...i,
                      hasReacted: !i.hasReacted,
                      post: {
                        ...i.post,
                        reactionCount: i.post.reactionCount + (i.hasReacted ? -1 : 1),
                      },
                    }
                  : i,
              ),
            }
          : old,
      );

      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.feed(scope), context.previous);
      toast.error('Could not save that', 'Check your connection.');
    },
  });

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.24, ease: [0.05, 0.7, 0.1, 1] }}
      className="panel overflow-hidden"
    >
      <p className="flex items-center gap-1.5 border-b border-border-subtle bg-surface-sunken px-4 py-2 text-xs font-medium text-fg-subtle">
        <ReasonIcon aria-hidden="true" className="size-3.5" />
        {reason.text}
      </p>

      <article className="p-4">
        <header className="flex items-start gap-3">
          <Avatar
            name={item.post.author.name}
            src={item.post.author.avatarUrl}
            size="md"
            shape={item.post.author.kind === 'company' ? 'rounded' : 'circle'}
            verified={item.post.author.isVerified}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">{item.post.author.name}</p>
            {item.post.author.headline && (
              <p className="truncate text-xs text-fg-subtle">{item.post.author.headline}</p>
            )}
            <p className="mt-0.5 text-2xs text-fg-faint">{relativeTime(item.post.createdAt)}</p>
          </div>
        </header>

        <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-fg text-pretty">
          {item.post.body}
        </p>

        {item.post.mediaUrl && (
          <img
            src={item.post.mediaUrl}
            alt=""
            loading="lazy"
            className="mt-3 w-full rounded-xl border border-border-subtle object-cover"
          />
        )}

        {item.post.tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {item.post.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-lg bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand-fg"
              >
                #{tag}
              </li>
            ))}
          </ul>
        )}

        <footer className="mt-4 flex items-center gap-1 border-t border-border-subtle pt-3">
          <button
            type="button"
            onClick={() => react.mutate()}
            aria-pressed={item.hasReacted}
            className={cn(
              'flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-[160ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              item.hasReacted
                ? 'text-accent-fg hover:bg-accent-subtle'
                : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
            )}
          >
            <Heart
              aria-hidden="true"
              className="size-4"
              fill={item.hasReacted ? 'currentColor' : 'none'}
            />
            {item.post.reactionCount > 0 && compactCount(item.post.reactionCount)}
            <span className="sr-only">{item.hasReacted ? 'Remove reaction' : 'React'}</span>
          </button>

          <button
            type="button"
            className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <MessageCircle aria-hidden="true" className="size-4" />
            {item.post.commentCount > 0 && compactCount(item.post.commentCount)}
            <span className="sr-only">Comment</span>
          </button>

          {item.post.authorAccountId === viewerId && (
            <span className="ml-auto text-2xs text-fg-faint">Yours</span>
          )}
        </footer>
      </article>
    </motion.li>
  );
}
