import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Hash } from 'lucide-react';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { feedApi, queryKeys } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { PostList } from './post-card';

/**
 * Every post carrying one hashtag, newest first.
 *
 * Chronological rather than ranked: a topic page is a place people arrive with
 * an exact expectation — "what is being said about this" — and reordering it by
 * engagement makes the same page look different on every visit.
 */
export function TagScreen() {
  const { tag = '' } = useParams();
  const { account } = useSession();
  const navigate = useNavigate();

  const normalised = decodeURIComponent(tag).replace(/^#/, '').toLowerCase();
  const cacheKey = queryKeys.tagFeed(normalised);

  const { data, isLoading } = useQuery({
    queryKey: cacheKey,
    queryFn: () => feedApi.getFeed({ tag: normalised, limit: 30 }),
    enabled: Boolean(normalised),
  });

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

      <header className="mb-5 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-subtle text-brand-fg"
        >
          <Hash className="size-6" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">#{normalised}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {isLoading
              ? 'Loading posts…'
              : `${data?.items.length ?? 0} recent ${data?.items.length === 1 ? 'post' : 'posts'}`}
          </p>
        </div>
      </header>

      {isLoading && (
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-40 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && data?.items.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Hash />}
            title={`Nothing tagged #${normalised} yet`}
            description="Be the first — add the tag to a post and it will show up here."
            action={
              <LinkButton to="/feed" size="sm" variant="outline">
                Write a post
              </LinkButton>
            }
          />
        </div>
      )}

      <PostList
        items={data?.items ?? []}
        viewerId={account?.id ?? ''}
        cacheKey={cacheKey}
        showReason={false}
      />
    </div>
  );
}
