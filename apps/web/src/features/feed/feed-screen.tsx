import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Building2,
  Compass,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import type { FeedItem, FeedReason, PostAuthor, PostMedia } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button, LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { MediaCarousel } from '@/components/ui/media-carousel';
import { MediaLightbox, type LightboxItem } from '@/components/ui/media-lightbox';
import { MediaPicker } from '@/components/ui/media-picker';
import { cn } from '@/lib/cn';
import { compactCount, relativeTime } from '@/lib/format';
import { feedApi, queryKeys } from '@/lib/api-endpoints';
import { postPath, postShareUrl } from '@/lib/post-link';
import { sharePost } from '@/lib/share';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';
import { Comments } from './comments';

/**
 * The "why am I seeing this" label.
 *
 * The ranker already computes a reason per item (see ranking.ts). Showing it
 * is what stops a ranked feed reading as arbitrary — and it is the difference
 * between a feed people trust and one they assume is manipulating them.
 */
const REASON_LABEL: Record<FeedReason, { text: string; icon: typeof Users }> = {
  connection: { text: 'From your network', icon: Users },
  following_account: { text: 'Someone you follow', icon: Users },
  following_company: { text: 'A company you follow', icon: Building2 },
  second_degree: { text: 'Someone your connections know', icon: Users },
  same_school: { text: 'From your school', icon: Sparkles },
  popular: { text: 'Popular on InternLink', icon: Compass },
  your_post: { text: 'Your post', icon: Sparkles },
};

type Scope = 'for_you' | 'following';

/** The media a post actually renders — a reshare shows the original's. */
function displayMedia(item: FeedItem): PostMedia[] {
  return item.post.resharedFrom ? item.post.resharedFrom.media : (item.post.media ?? []);
}

export function FeedScreen() {
  const [scope, setScope] = useState<Scope>('for_you');
  const [lightboxAt, setLightboxAt] = useState<number | null>(null);
  const { account } = useSession();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.feed(scope),
    queryFn: () => feedApi.getFeed(scope),
  });

  /**
   * Every piece of media in the feed, flattened into one column.
   *
   * The viewer is built from the whole feed rather than from one post so that
   * swiping up keeps going past the post you opened. `offsets` maps a post back
   * to where its first item lands, which is what lets a card open the viewer at
   * the right place without knowing anything about the others.
   */
  const { lightboxItems, offsets } = useMemo(() => {
    const flat: LightboxItem[] = [];
    const starts = new Map<string, number>();

    for (const item of data?.items ?? []) {
      const media = displayMedia(item);
      if (media.length === 0) continue;

      starts.set(item.post.id, flat.length);
      const source = item.post.resharedFrom ?? item.post;

      for (const entry of media) {
        flat.push({
          media: entry,
          author: source.author,
          postId: item.post.id,
          caption: source.body,
        });
      }
    }

    return { lightboxItems: flat, offsets: starts };
  }, [data]);

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
                ? 'Follow a few people and companies, and their updates will appear here.'
                : 'Be the first to post something — or find a few people to follow.'
            }
            action={
              <LinkButton to="/network" size="sm" variant="outline">
                Find people
              </LinkButton>
            }
          />
        </div>
      )}

      <ul className="mt-5 flex flex-col gap-4">
        <AnimatePresence initial={false}>
          {data?.items.map((item) => (
            <PostCard
              key={item.post.id}
              item={item}
              viewerId={account?.id ?? ''}
              scope={scope}
              onOpenMedia={(localIndex) => {
                const start = offsets.get(item.post.id);
                if (start !== undefined) setLightboxAt(start + localIndex);
              }}
            />
          ))}
        </AnimatePresence>
      </ul>

      {lightboxAt !== null && lightboxItems.length > 0 && (
        <MediaLightbox
          items={lightboxItems}
          startIndex={lightboxAt}
          onClose={() => setLightboxAt(null)}
        />
      )}
    </div>
  );
}

function Composer() {
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<PostMedia[]>([]);
  const [asCompany, setAsCompany] = useState(false);
  const [allowResharing, setAllowResharing] = useState(true);
  const { account, company } = useSession();
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () =>
      feedApi.createPost({
        kind: 'update',
        body: body.trim(),
        media,
        tags: [],
        asCompany,
        allowResharing,
      }),
    onSuccess: () => {
      setBody('');
      setMedia([]);
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
  // A photo with no caption is a perfectly ordinary post.
  const canSubmit = Boolean(body.trim()) || media.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !create.isPending) create.mutate();
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

      <MediaPicker value={media} onChange={setMedia} disabled={create.isPending} />

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle pt-3">
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

        {/* FR-1007 — the author decides whether their post can travel. Set at
            composition time, and changeable later from the post's own menu. */}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={allowResharing}
            onChange={(e) => setAllowResharing(e.target.checked)}
            className="size-4 cursor-pointer accent-[var(--brand)]"
          />
          Allow resharing
        </label>

        <span className="ml-auto text-xs text-fg-faint tabular-nums">{body.length}/3000</span>

        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          isLoading={create.isPending}
          rightIcon={<Send />}
        >
          Post
        </Button>
      </div>
    </form>
  );
}

/**
 * An author's name and avatar, linking through to their profile.
 *
 * Company authors link to the company page, which does not exist yet — so they
 * render as plain text rather than as a link into a dead end.
 */
function AuthorLink({
  author,
  timestamp,
  children,
}: {
  author: PostAuthor;
  timestamp?: string;
  children?: React.ReactNode;
}) {
  const isPerson = author.kind === 'account';

  const identity = (
    <>
      <Avatar
        name={author.name}
        src={author.avatarUrl}
        size="md"
        shape={isPerson ? 'circle' : 'rounded'}
        verified={author.isVerified}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm font-semibold text-fg',
            isPerson && 'group-hover:underline',
          )}
        >
          {author.name}
        </span>
        {author.headline && (
          <span className="block truncate text-xs text-fg-subtle">{author.headline}</span>
        )}
        {timestamp && (
          <span className="mt-0.5 block text-2xs text-fg-faint">{relativeTime(timestamp)}</span>
        )}
      </span>
    </>
  );

  if (!isPerson) {
    return <span className="flex min-w-0 flex-1 items-start gap-3">{identity}</span>;
  }

  return (
    <span className="flex min-w-0 flex-1 items-start gap-3">
      <Link
        to={`/u/${author.id}`}
        className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        {identity}
      </Link>
      {children}
    </span>
  );
}

function PostCard({
  item,
  viewerId,
  scope,
  onOpenMedia,
}: {
  item: FeedItem;
  viewerId: string;
  scope: Scope;
  onOpenMedia: (localIndex: number) => void;
}) {
  const queryClient = useQueryClient();
  const [showComments, setShowComments] = useState(false);
  const reason = REASON_LABEL[item.reason];
  const ReasonIcon = reason.icon;
  const post = item.post;
  const isMine = post.authorAccountId === viewerId;

  // Optimistic: a like that waits on a round trip feels broken. The rollback
  // in onError puts it back if the write actually failed.
  const react = useMutation({
    mutationFn: () => feedApi.toggleReaction(post.id),
    onMutate: async () => {
      const key = queryKeys.feed(scope);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ items: FeedItem[] }>(key);

      queryClient.setQueryData<{ items: FeedItem[] }>(key, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((i) =>
                i.post.id === post.id
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

  const reshare = useMutation({
    mutationFn: () => feedApi.reshare(post.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast.success('Reshared', 'It is now on your profile and in your followers’ feeds.');
    },
    onError: (error) => {
      toast.error(
        'Could not reshare',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  // What the card actually shows: a reshare renders the quoted post's media,
  // never its own — a reshare has none.
  const quoted = post.resharedFrom;
  const media = quoted ? quoted.media : (post.media ?? []);
  const legacyImage = !quoted && media.length === 0 && post.mediaUrl ? post.mediaUrl : null;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.24, ease: [0.05, 0.7, 0.1, 1] }}
      // Not `overflow-hidden`: the post menu is absolutely positioned inside
      // this card, and clipping it would cut the dropdown off on a short post.
      // The reason bar inherits the card's radius instead, which is the only
      // thing the clipping was doing.
      className="panel relative"
    >
      <p className="flex items-center gap-1.5 rounded-t-[inherit] border-b border-border-subtle bg-surface-sunken px-4 py-2 text-xs font-medium text-fg-subtle">
        <ReasonIcon aria-hidden="true" className="size-3.5" />
        {reason.text}
      </p>

      <article className="p-4">
        <header className="flex items-start gap-3">
          <AuthorLink author={post.author} timestamp={post.createdAt} />
          {isMine && <PostMenu post={post} scope={scope} />}
        </header>

        {post.body && (
          <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-fg text-pretty">
            {post.body}
          </p>
        )}

        {quoted ? (
          <QuotedPost
            author={quoted.author}
            body={quoted.body}
            media={quoted.media}
            createdAt={quoted.createdAt}
            postId={quoted.postId}
            onOpenMedia={onOpenMedia}
          />
        ) : (
          <>
            {media.length > 0 && (
              <MediaCarousel media={media} className="mt-3" onOpen={onOpenMedia} />
            )}
            {legacyImage && (
              <img
                src={legacyImage}
                alt=""
                loading="lazy"
                className="mt-3 w-full rounded-xl border border-border-subtle object-cover"
              />
            )}
          </>
        )}

        {post.tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
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
          <ActionButton
            label={item.hasReacted ? 'Remove reaction' : 'React'}
            count={post.reactionCount}
            isActive={item.hasReacted}
            activeClassName="text-accent-fg hover:bg-accent-subtle"
            onClick={() => react.mutate()}
            aria-pressed={item.hasReacted}
            icon={<Heart className="size-4" fill={item.hasReacted ? 'currentColor' : 'none'} />}
          />

          <ActionButton
            label={showComments ? 'Hide comments' : 'Show comments'}
            count={post.commentCount}
            isActive={showComments}
            activeClassName="bg-surface-sunken text-fg"
            onClick={() => setShowComments((v) => !v)}
            aria-expanded={showComments}
            icon={<MessageCircle className="size-4" />}
          />

          {/* Resharing off is the author's call, so the control disappears
              rather than sitting there disabled and inviting a click. */}
          {post.allowResharing !== false && (
            <ActionButton
              label="Reshare"
              count={post.shareCount ?? 0}
              isActive={false}
              activeClassName=""
              disabled={reshare.isPending}
              onClick={() => reshare.mutate()}
              icon={<Repeat2 className="size-4" />}
            />
          )}

          {/* Sharing a link is not the same as resharing into the feed, so it
              stays available even when the author has turned resharing off —
              the post is already visible to whoever can see this card. */}
          <ActionButton
            label="Share a link to this post"
            count={0}
            isActive={false}
            activeClassName=""
            onClick={() => {
              const source = quoted ?? post;
              void sharePost({
                url: postShareUrl(quoted ? quoted.postId : post.id),
                authorName: source.author.name,
                body: source.body,
              });
            }}
            icon={<Share2 className="size-4" />}
          />

          {isMine && <span className="ml-auto text-2xs text-fg-faint">Yours</span>}
        </footer>
      </article>

      {showComments && <Comments postId={post.id} scope={scope} viewerId={viewerId} />}
    </motion.li>
  );
}

function ActionButton({
  label,
  count,
  icon,
  isActive,
  activeClassName,
  onClick,
  disabled,
  ...rest
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  isActive: boolean;
  activeClassName: string;
  onClick: () => void;
  disabled?: boolean;
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-[160ms]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        isActive ? activeClassName : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
      )}
      {...rest}
    >
      <span aria-hidden="true" className="contents">
        {icon}
      </span>
      {count > 0 && compactCount(count)}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** The original post, rendered inside a reshare. */
function QuotedPost({
  author,
  body,
  media,
  createdAt,
  postId,
  onOpenMedia,
}: {
  author: PostAuthor;
  body: string;
  media: PostMedia[];
  createdAt: string;
  postId: string;
  onOpenMedia: (localIndex: number) => void;
}) {
  return (
    <article className="mt-3 overflow-hidden rounded-xl border border-border-default bg-surface-sunken">
      <header className="flex items-start gap-2.5 px-3 pt-3">
        {author.kind === 'account' ? (
          <Link
            to={`/u/${author.id}`}
            className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <Avatar name={author.name} src={author.avatarUrl} size="xs" verified={author.isVerified} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-fg group-hover:underline">
                {author.name}
              </span>
              <span className="block text-2xs text-fg-faint">{relativeTime(createdAt)}</span>
            </span>
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar
              name={author.name}
              src={author.avatarUrl}
              size="xs"
              shape="rounded"
              verified={author.isVerified}
            />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-fg">{author.name}</span>
              <span className="block text-2xs text-fg-faint">{relativeTime(createdAt)}</span>
            </span>
          </span>
        )}
      </header>

      {body && (
        <p className="px-3 pt-2 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted text-pretty">
          {body}
        </p>
      )}

      {media.length > 0 && (
        <MediaCarousel media={media} className="mt-2 px-3 pb-3" onOpen={onOpenMedia} />
      )}

      <Link
        to={postPath(postId)}
        className="block px-3 pb-3 text-2xs font-medium text-fg-subtle underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        See original post
      </Link>
    </article>
  );
}

/** The author's own controls on a post. */
function PostMenu({ post, scope }: { post: FeedItem['post']; scope: Scope }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside and Escape both close it. A menu you can only dismiss by
  // picking something from it is a trap on touch.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const setResharing = useMutation({
    mutationFn: (allowResharing: boolean) => feedApi.updatePost(post.id, { allowResharing }),
    onSuccess: (_result, allowResharing) => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast.success(allowResharing ? 'Resharing is on' : 'Resharing is off');
      setOpen(false);
    },
    onError: () => toast.error('Could not change that', 'Try again in a moment.'),
  });

  const remove = useMutation({
    mutationFn: () => feedApi.deletePost(post.id),
    onMutate: async () => {
      const key = queryKeys.feed(scope);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ items: FeedItem[] }>(key);
      queryClient.setQueryData<{ items: FeedItem[] }>(key, (old) =>
        old ? { ...old, items: old.items.filter((i) => i.post.id !== post.id) } : old,
      );
      return { previous };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast.success('Post deleted');
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.feed(scope), context.previous);
      toast.error('Could not delete that post');
    },
  });

  const allowResharing = post.allowResharing !== false;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Post options"
        className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-10 right-0 z-30 w-60 overflow-hidden rounded-xl border border-border-default bg-surface p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={allowResharing}
            disabled={setResharing.isPending}
            onClick={() => setResharing.mutate(!allowResharing)}
            className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-fg transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <Repeat2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
            <span>
              {allowResharing ? 'Turn off resharing' : 'Turn on resharing'}
              <span className="mt-0.5 block text-xs text-fg-subtle">
                {allowResharing
                  ? 'Others can no longer pass this on.'
                  : 'Let others pass this on to their feed.'}
              </span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-danger-fg transition-colors hover:bg-danger-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <Trash2 aria-hidden="true" className="size-4 shrink-0" />
            Delete post
          </button>
        </div>
      )}
    </div>
  );
}
