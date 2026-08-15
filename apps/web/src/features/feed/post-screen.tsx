import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileQuestion, Heart, MessageCircle, Repeat2, Share2 } from 'lucide-react';
import type { PostMedia } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { MediaCarousel } from '@/components/ui/media-carousel';
import { MediaLightbox, type LightboxItem } from '@/components/ui/media-lightbox';
import { cn } from '@/lib/cn';
import { compactCount, relativeTime } from '@/lib/format';
import { feedApi } from '@/lib/api-endpoints';
import { sharePost } from '@/lib/share';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';
import { Comments } from './comments';

const postKey = (id: string) => ['feed', 'post', id] as const;

/**
 * A single post at `/p/:id` — where a shared link lands.
 *
 * On the Vercel host that path is intercepted and served by the API's share
 * endpoint, which emits Open Graph tags and then bounces the visitor here. On a
 * host that cannot proxy, this route answers directly: the link still works,
 * it just does not unfurl with a preview.
 *
 * Comments open by default. Someone arriving from a link has been sent to this
 * specific post, and the conversation is usually why.
 */
export function PostScreen() {
  const { postId = '' } = useParams();
  const { account } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [lightboxAt, setLightboxAt] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: postKey(postId),
    queryFn: () => feedApi.getPost(postId),
    enabled: Boolean(postId),
  });

  const post = data?.post;
  const quoted = post?.resharedFrom ?? null;
  const source = quoted ?? post ?? null;
  const media: PostMedia[] = useMemo(
    () => (quoted ? quoted.media : (post?.media ?? [])),
    [quoted, post],
  );

  const lightboxItems: LightboxItem[] = useMemo(
    () =>
      source
        ? media.map((entry) => ({
            media: entry,
            author: source.author,
            postId: postId,
            caption: source.body,
          }))
        : [],
    [media, source, postId],
  );

  const react = useMutation({
    mutationFn: () => feedApi.toggleReaction(postId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: postKey(postId) });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: () => toast.error('Could not save that', 'Check your connection.'),
  });

  const reshare = useMutation({
    mutationFn: () => feedApi.reshare(postId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: postKey(postId) });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast.success('Reshared');
    },
    onError: (err) => {
      toast.error(
        'Could not reshare',
        err instanceof ApiRequestError ? err.message : 'Try again in a moment.',
      );
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
        <div className="skeleton h-72 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !post || !source) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
        <div className="panel">
          <EmptyState
            icon={<FileQuestion />}
            title="This post is not available"
            description={
              error instanceof ApiRequestError
                ? error.message
                : 'It may have been deleted, or it is still under review.'
            }
            action={
              <Button size="sm" variant="outline" onClick={() => navigate('/feed')}>
                Go to your feed
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const isPerson = post.author.kind === 'account';

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-3 flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back
      </button>

      <article className="panel">
        <header className="flex items-start gap-3 p-4">
          {isPerson ? (
            <Link
              to={`/u/${post.author.id}`}
              className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Avatar
                name={post.author.name}
                src={post.author.avatarUrl}
                size="md"
                verified={post.author.isVerified}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg group-hover:underline">
                  {post.author.name}
                </span>
                {post.author.headline && (
                  <span className="block truncate text-xs text-fg-subtle">
                    {post.author.headline}
                  </span>
                )}
                <span className="mt-0.5 block text-2xs text-fg-faint">
                  {relativeTime(post.createdAt)}
                </span>
              </span>
            </Link>
          ) : (
            <span className="flex min-w-0 flex-1 items-start gap-3">
              <Avatar
                name={post.author.name}
                src={post.author.avatarUrl}
                size="md"
                shape="rounded"
                verified={post.author.isVerified}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg">
                  {post.author.name}
                </span>
                <span className="mt-0.5 block text-2xs text-fg-faint">
                  {relativeTime(post.createdAt)}
                </span>
              </span>
            </span>
          )}
        </header>

        {post.body && (
          <p className="px-4 text-sm leading-relaxed whitespace-pre-wrap text-fg text-pretty">
            {post.body}
          </p>
        )}

        {quoted && (
          <div className="mx-4 mt-3 rounded-xl border border-border-default bg-surface-sunken p-3">
            <p className="text-xs font-semibold text-fg">{quoted.author.name}</p>
            {quoted.body && (
              <p className="mt-1 text-sm whitespace-pre-wrap text-fg-muted">{quoted.body}</p>
            )}
          </div>
        )}

        {media.length > 0 && (
          <MediaCarousel media={media} className="mt-3 px-4" onOpen={setLightboxAt} />
        )}

        <footer className="mt-4 flex items-center gap-1 border-t border-border-subtle px-4 py-3">
          <PostAction
            label={data.hasReacted ? 'Remove reaction' : 'React'}
            count={post.reactionCount}
            isActive={data.hasReacted}
            onClick={() => react.mutate()}
            icon={<Heart className="size-4" fill={data.hasReacted ? 'currentColor' : 'none'} />}
          />
          <PostAction
            label="Comments"
            count={post.commentCount}
            isActive={false}
            onClick={() => undefined}
            icon={<MessageCircle className="size-4" />}
          />
          {post.allowResharing !== false && (
            <PostAction
              label="Reshare"
              count={post.shareCount ?? 0}
              isActive={false}
              disabled={reshare.isPending}
              onClick={() => reshare.mutate()}
              icon={<Repeat2 className="size-4" />}
            />
          )}
          <PostAction
            label="Share a link"
            count={0}
            isActive={false}
            onClick={() =>
              void sharePost({
                url: data.shareUrl,
                authorName: source.author.name,
                body: source.body,
              })
            }
            icon={<Share2 className="size-4" />}
          />
        </footer>

        <Comments postId={postId} scope="for_you" viewerId={account?.id ?? ''} />
      </article>

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

function PostAction({
  label,
  count,
  icon,
  isActive,
  onClick,
  disabled,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isActive}
      className={cn(
        'flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-[160ms]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        isActive ? 'text-accent-fg hover:bg-accent-subtle' : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
      )}
    >
      <span aria-hidden="true" className="contents">
        {icon}
      </span>
      {count > 0 && compactCount(count)}
      <span className="sr-only">{label}</span>
    </button>
  );
}
