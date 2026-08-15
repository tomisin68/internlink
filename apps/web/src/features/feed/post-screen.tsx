import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileQuestion } from 'lucide-react';
import type { FeedItem } from '@internlink/shared-types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { feedApi } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { ApiRequestError } from '@/lib/api-client';
import { PostList } from './post-card';

const postKey = (id: string) => ['feed', 'post', id] as const;

/**
 * A single post at `/p/:id` — where a shared link lands.
 *
 * On the Vercel host that path is intercepted and served by the API's share
 * endpoint, which emits Open Graph tags and then bounces the visitor here. On a
 * host that cannot proxy, this route answers directly: the link still works,
 * it just does not unfurl with a preview.
 *
 * The card itself is the same component the feed renders. It used to be a
 * parallel implementation, which is how it ended up without saving, reporting,
 * hashtags or a follow button — every feature added to the feed had to be
 * remembered here too, and none of them were.
 */
export function PostScreen() {
  const { postId = '' } = useParams();
  const { account } = useSession();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: postKey(postId),
    queryFn: () => feedApi.getPost(postId),
    enabled: Boolean(postId),
  });

  /**
   * The permalink payload, shaped as the one-item feed the list expects.
   *
   * `reason` is `your_post`/`popular` only as a placeholder — the reason bar is
   * switched off below, because "why am I seeing this" has an obvious answer
   * when you followed a link to it.
   */
  const items: FeedItem[] = useMemo(() => {
    if (!data) return [];
    return [
      {
        post: data.post,
        reason: data.post.authorAccountId === account?.id ? 'your_post' : 'popular',
        relationship: 'none',
        score: 0,
        hasReacted: data.hasReacted,
        isBookmarked: data.isBookmarked,
        isFollowingAuthor: data.isFollowingAuthor,
        interactionPostId: data.post.resharedFrom?.postId ?? data.post.id,
        reactors: data.reactors,
      },
    ];
  }, [data, account?.id]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
        <div className="skeleton h-72 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
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

      <PostList
        items={items}
        viewerId={account?.id ?? ''}
        cacheKey={postKey(postId)}
        showReason={false}
        // Someone arriving from a link has been sent to this specific post, and
        // the conversation is usually why.
        defaultOpenComments
      />
    </div>
  );
}
