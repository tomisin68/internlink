import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/feedback';
import { feedApi, queryKeys } from '@/lib/api-endpoints';
import { PostList } from '@/features/feed/post-card';

/**
 * Somebody's posts, on their profile.
 *
 * Chronological and unranked — a profile is an archive, and reordering it by
 * engagement makes the page look different every time you open it.
 *
 * Reuses the feed's card so a post looks and behaves the same everywhere: the
 * alternative was a second, thinner post renderer that would have quietly
 * missed saving, reporting, hashtags and the reshare rules.
 */
export function ProfilePosts({
  accountId,
  viewerId,
  emptyTitle,
  emptyDescription,
}: {
  accountId: string;
  viewerId: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const cacheKey = queryKeys.authorFeed(accountId);

  const { data, isLoading } = useQuery({
    queryKey: cacheKey,
    queryFn: () => feedApi.getFeed({ authorId: accountId, limit: 30 }),
    enabled: Boolean(accountId),
  });

  if (isLoading) {
    return (
      <div className="mt-4 flex flex-col gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="skeleton h-40 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="panel mt-4">
        <EmptyState icon={<FileText />} title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className="mt-4">
      <PostList
        items={data.items}
        viewerId={viewerId}
        cacheKey={cacheKey}
        // Every post here is by the same person; "From your network" on all of
        // them says nothing.
        showReason={false}
      />
    </div>
  );
}
