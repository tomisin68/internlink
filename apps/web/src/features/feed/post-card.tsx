import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Bookmark,
  Building2,
  Compass,
  Flag,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Share2,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import type { FeedItem, FeedReason, PostAuthor, PostMedia } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MediaCarousel } from '@/components/ui/media-carousel';
import { MediaLightbox, type LightboxItem } from '@/components/ui/media-lightbox';
import { ReportDialog } from '@/components/ui/report-dialog';
import { HashtagList, RichText } from '@/components/ui/rich-text';
import { cn } from '@/lib/cn';
import { compactCount, relativeTime } from '@/lib/format';
import { feedApi, networkApi } from '@/lib/api-endpoints';
import { postPath, postShareUrl } from '@/lib/post-link';
import { sharePost } from '@/lib/share';
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

/** Where an author's name points: a person's profile, or a company page. */
export function authorPath(author: PostAuthor): string {
  return author.kind === 'company' ? `/c/${author.id}` : `/u/${author.id}`;
}

/** The media a post actually renders — a reshare shows the original's. */
export function displayMedia(item: FeedItem): PostMedia[] {
  return item.post.resharedFrom ? item.post.resharedFrom.media : (item.post.media ?? []);
}

/**
 * What tapping a piece of media opens.
 *
 * Photos open their own post and nothing else: someone tapping a picture wants
 * a bigger version of *that* picture, and dropping them into a column
 * containing every image on the platform was disorienting — you could not get
 * back to the post you came from, and the next swipe was a stranger's holiday.
 *
 * Video is the opposite. A tapped video opens a reel of every video in the
 * feed, because "watch this one, then keep swiping" is the gesture people
 * arrive with from every short-video app, and stopping after one is the
 * surprising behaviour there.
 */
type OpenMedia = (item: FeedItem, localIndex: number) => void;

/* ============================================================== PostList == */

export interface PostListProps {
  items: FeedItem[];
  viewerId: string;
  /** The cache entry to update optimistically when this list's posts change. */
  cacheKey: QueryKey;
  /** Rendered above the actions on each card. Off on single-author lists. */
  showReason?: boolean;
  /** Comments open by default — used by the permalink screen. */
  defaultOpenComments?: boolean;
}

/**
 * A list of post cards plus the fullscreen viewer they share.
 *
 * The viewer lives here rather than in each card because a video reel spans the
 * whole list: opening one video has to know about all the others.
 */
export function PostList({
  items,
  viewerId,
  cacheKey,
  showReason = true,
  defaultOpenComments = false,
}: PostListProps) {
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);

  /** Every video in the list, in order — the reel a tapped video opens into. */
  const videoReel = useMemo(() => {
    const reel: LightboxItem[] = [];
    const positions = new Map<string, number>();

    for (const item of items) {
      const source = item.post.resharedFrom ?? item.post;
      for (const media of displayMedia(item)) {
        if (media.kind !== 'video') continue;
        positions.set(`${item.post.id}::${media.url}`, reel.length);
        reel.push({
          media,
          author: source.author,
          postId: item.post.id,
          caption: source.body,
        });
      }
    }

    return { reel, positions };
  }, [items]);

  const openMedia: OpenMedia = (item, localIndex) => {
    const media = displayMedia(item);
    const target = media[localIndex];
    if (!target) return;

    if (target.kind === 'video') {
      const index = videoReel.positions.get(`${item.post.id}::${target.url}`);
      if (index !== undefined) {
        setLightbox({ items: videoReel.reel, index });
        return;
      }
    }

    // Photos stay inside their own post.
    const source = item.post.resharedFrom ?? item.post;
    setLightbox({
      items: media.map((entry) => ({
        media: entry,
        author: source.author,
        postId: item.post.id,
        caption: source.body,
      })),
      index: localIndex,
    });
  };

  return (
    <>
      <ul className="flex flex-col gap-4">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <PostCard
              key={item.post.id}
              item={item}
              viewerId={viewerId}
              cacheKey={cacheKey}
              showReason={showReason}
              defaultOpenComments={defaultOpenComments}
              onOpenMedia={(localIndex) => openMedia(item, localIndex)}
            />
          ))}
        </AnimatePresence>
      </ul>

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

/* ============================================================== PostCard == */

function PostCard({
  item,
  viewerId,
  cacheKey,
  showReason,
  defaultOpenComments,
  onOpenMedia,
}: {
  item: FeedItem;
  viewerId: string;
  cacheKey: QueryKey;
  showReason: boolean;
  defaultOpenComments: boolean;
  onOpenMedia: (localIndex: number) => void;
}) {
  const queryClient = useQueryClient();
  const [showComments, setShowComments] = useState(defaultOpenComments);
  const reason = REASON_LABEL[item.reason];
  const ReasonIcon = reason.icon;
  const post = item.post;
  const isMine = post.authorAccountId === viewerId;

  // Likes and comments on a reshare belong to the original — the server
  // resolves that, and this is the id every engagement action addresses.
  const interactionId = item.interactionPostId || post.id;

  /**
   * Patches this post inside whichever list cache it came from.
   *
   * `patched` is false when the cache is not a list — the permalink screen
   * stores a single `PostDetail` under its own key. Rather than teach this
   * component two cache shapes, the caller falls back to invalidating, which is
   * cheap for a one-post screen and wrong for a feed (it would refetch and
   * reorder twenty cards because someone tapped a heart).
   */
  function patchItem(update: (current: FeedItem) => FeedItem): {
    previous: unknown;
    patched: boolean;
  } {
    const previous = queryClient.getQueryData<{ items?: FeedItem[] }>(cacheKey);
    if (!previous || !Array.isArray(previous.items)) return { previous, patched: false };

    queryClient.setQueryData<{ items: FeedItem[] }>(cacheKey, (old) =>
      old
        ? { ...old, items: old.items.map((i) => (i.post.id === post.id ? update(i) : i)) }
        : old,
    );
    return { previous, patched: true };
  }

  // Optimistic: a like that waits on a round trip feels broken. The rollback
  // in onError puts it back if the write actually failed.
  const react = useMutation({
    mutationFn: () => feedApi.toggleReaction(interactionId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: cacheKey });
      return patchItem((current) => ({
        ...current,
        hasReacted: !current.hasReacted,
        post: {
          ...current.post,
          reactionCount: Math.max(0, current.post.reactionCount + (current.hasReacted ? -1 : 1)),
        },
      }));
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(cacheKey, context.previous);
      toast.error('Could not save that', 'Check your connection.');
    },
    onSuccess: (_result, _vars, context) => {
      // Other lists showing the same post (a profile tab, a tag page) are now
      // stale, but refetching them under the reader would reorder the feed —
      // so they are marked stale and left to refresh on their next mount.
      void queryClient.invalidateQueries({ queryKey: ['feed'], exact: false, refetchType: 'none' });
      if (!context?.patched) void queryClient.invalidateQueries({ queryKey: cacheKey });
    },
  });

  const bookmark = useMutation({
    mutationFn: () => feedApi.toggleBookmark(post.id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: cacheKey });
      return patchItem((current) => ({ ...current, isBookmarked: !current.isBookmarked }));
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(cacheKey, context.previous);
      toast.error('Could not save that post');
    },
    onSuccess: (result, _vars, context) => {
      void queryClient.invalidateQueries({ queryKey: ['feed', 'saved'] });
      if (!context?.patched) void queryClient.invalidateQueries({ queryKey: cacheKey });
      toast.success(result.isBookmarked ? 'Saved' : 'Removed from saved');
    },
  });

  const follow = useMutation({
    mutationFn: () =>
      post.author.kind === 'company'
        ? networkApi.follow(post.author.id)
        : networkApi.followAccount(post.author.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['network'] });
      toast.success(
        'mutual' in result && result.mutual
          ? `You and ${post.author.name} now follow each other`
          : `Following ${post.author.name}`,
      );
    },
    onError: () => toast.error('Could not follow', 'Try again in a moment.'),
  });

  const reshare = useMutation({
    mutationFn: () => feedApi.reshare(interactionId),
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

  // A person can be followed from the card; a company you already follow, or
  // your own post, has nothing to offer.
  const canFollow = !isMine && !item.isFollowingAuthor && post.author.id !== viewerId;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.24, ease: [0.05, 0.7, 0.1, 1] }}
      // Not `overflow-hidden`: the post menu is absolutely positioned inside
      // this card, and clipping it would cut the dropdown off on a short post.
      className="panel relative"
    >
      {showReason && (
        <p className="flex items-center gap-1.5 rounded-t-[inherit] border-b border-border-subtle bg-surface-sunken px-4 py-2 text-xs font-medium text-fg-subtle">
          <ReasonIcon aria-hidden="true" className="size-3.5" />
          {reason.text}
        </p>
      )}

      <article className="p-4">
        <header className="flex items-start gap-3">
          <AuthorLink author={post.author} timestamp={post.createdAt} />

          {canFollow && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<UserPlus />}
              isLoading={follow.isPending}
              onClick={() => follow.mutate()}
              className="shrink-0 text-brand-fg"
            >
              Follow
            </Button>
          )}

          <PostMenu
            post={post}
            cacheKey={cacheKey}
            isMine={isMine}
            authorName={post.author.name}
          />
        </header>

        {post.body && (
          <RichText
            body={post.body}
            mentions={post.mentions ?? []}
            className="mt-3 text-sm leading-relaxed text-fg"
          />
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

        <HashtagList tags={post.tags ?? []} className="mt-3" />

        <ReactorLine
          reactors={item.reactors ?? []}
          total={post.reactionCount}
          viewerReacted={item.hasReacted}
        />

        <footer className="mt-3 flex items-center gap-1 border-t border-border-subtle pt-3">
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
              stays available even when the author has turned resharing off. */}
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

          <ActionButton
            label={item.isBookmarked ? 'Remove from saved' : 'Save this post'}
            count={0}
            isActive={item.isBookmarked}
            activeClassName="text-brand-fg hover:bg-brand-subtle"
            onClick={() => bookmark.mutate()}
            aria-pressed={item.isBookmarked}
            className="ml-auto"
            icon={
              <Bookmark className="size-4" fill={item.isBookmarked ? 'currentColor' : 'none'} />
            }
          />
        </footer>
      </article>

      {showComments && <Comments postId={interactionId} cacheKey={cacheKey} viewerId={viewerId} />}
    </motion.li>
  );
}

/**
 * "Liked by Ada and 24 others".
 *
 * Social proof only works if it names someone the reader might know, which is
 * why the server pulls connections and follows to the front of the sample. With
 * nobody recognisable to name it falls back to the bare count, which is still
 * worth showing — but "Liked by 3 people you have never heard of" is not.
 */
function ReactorLine({
  reactors,
  total,
  viewerReacted,
}: {
  reactors: FeedItem['reactors'];
  total: number;
  viewerReacted: boolean;
}) {
  if (total <= 0) return null;

  const named = reactors.slice(0, 2);
  const others = Math.max(0, total - named.length);

  return (
    <p className="mt-3 flex items-center gap-2 text-xs text-fg-subtle">
      {named.length > 0 && (
        <span className="flex -space-x-1.5">
          {named.map((person) => (
            <Avatar
              key={person.id}
              name={person.displayName}
              src={person.photoUrl}
              size="2xs"
              className="ring-2 ring-[var(--bg-surface)]"
            />
          ))}
        </span>
      )}

      <span className="min-w-0 truncate">
        {named.length === 0 ? (
          <>
            {compactCount(total)} {total === 1 ? 'reaction' : 'reactions'}
          </>
        ) : (
          <>
            Liked by{' '}
            {named.map((person, index) => (
              <span key={person.id}>
                {index > 0 && ', '}
                <Link
                  to={`/u/${person.id}`}
                  className="font-medium text-fg underline-offset-2 hover:underline"
                >
                  {person.displayName}
                </Link>
              </span>
            ))}
            {others > 0 && ` and ${compactCount(others)} ${others === 1 ? 'other' : 'others'}`}
          </>
        )}
        {viewerReacted && named.length > 0 && ' · including you'}
      </span>
    </p>
  );
}

/** An author's name and avatar, linking through to their page. */
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

  return (
    <span className="flex min-w-0 flex-1 items-start gap-3">
      <Link
        to={authorPath(author)}
        className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <Avatar
          name={author.name}
          src={author.avatarUrl}
          size="md"
          shape={isPerson ? 'circle' : 'rounded'}
          verified={author.isVerified}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg group-hover:underline">
            {author.name}
          </span>
          {author.headline && (
            <span className="block truncate text-xs text-fg-subtle">{author.headline}</span>
          )}
          {timestamp && (
            <span className="mt-0.5 block text-2xs text-fg-faint">{relativeTime(timestamp)}</span>
          )}
        </span>
      </Link>
      {children}
    </span>
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
  className,
  ...rest
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  isActive: boolean;
  activeClassName: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
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
        className,
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
        <Link
          to={authorPath(author)}
          className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <Avatar
            name={author.name}
            src={author.avatarUrl}
            size="xs"
            shape={author.kind === 'company' ? 'rounded' : 'circle'}
            verified={author.isVerified}
          />
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-fg group-hover:underline">
              {author.name}
            </span>
            <span className="block text-2xs text-fg-faint">{relativeTime(createdAt)}</span>
          </span>
        </Link>
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

/**
 * The overflow menu on a post.
 *
 * Two different menus behind one button: the author gets resharing and delete,
 * everyone else gets report. Splitting them into separate affordances would put
 * a flag icon on every card in the feed, which sets a tone this product does
 * not want — reporting should be available, not advertised.
 */
function PostMenu({
  post,
  cacheKey,
  isMine,
  authorName,
}: {
  post: FeedItem['post'];
  cacheKey: QueryKey;
  isMine: boolean;
  authorName: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
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
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const previous = queryClient.getQueryData<{ items?: FeedItem[] }>(cacheKey);
      // Only list caches can drop a row optimistically; the permalink screen's
      // single-post cache has nothing to filter.
      if (previous && Array.isArray(previous.items)) {
        queryClient.setQueryData<{ items: FeedItem[] }>(cacheKey, (old) =>
          old ? { ...old, items: old.items.filter((i) => i.post.id !== post.id) } : old,
        );
      }
      return { previous };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast.success('Post deleted');
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(cacheKey, context.previous);
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
          {isMine ? (
            <>
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
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setReporting(true);
              }}
              className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-fg transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Flag aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger-fg" />
              <span>
                Report this post
                <span className="mt-0.5 block text-xs text-fg-subtle">
                  {authorName} is not told who reported it.
                </span>
              </span>
            </button>
          )}
        </div>
      )}

      {reporting && (
        <ReportDialog
          targetType="post"
          targetId={post.id}
          subject={`${authorName}’s post`}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}
