import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Send } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/button';
import { relativeTime } from '@/lib/format';
import { feedApi, queryKeys } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

/**
 * Inline comment thread, expanded under a feed post.
 *
 * Loaded lazily — the query is disabled until the section is actually opened,
 * so a feed page of twenty posts does not fire twenty comment requests for
 * threads nobody has looked at.
 */
export function Comments({ postId, scope }: { postId: string; scope: 'for_you' | 'following' }) {
  const { account } = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.comments(postId),
    queryFn: () => feedApi.listComments(postId),
  });

  const add = useMutation({
    mutationFn: (body: string) => feedApi.addComment(postId, { body }),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(postId) });
      // The post's commentCount lives on the feed item, so that cache needs
      // refreshing too or the button keeps showing the old number.
      void queryClient.invalidateQueries({ queryKey: queryKeys.feed(scope) });
    },
    onError: (error) => {
      toast.error(
        'Comment not posted',
        error instanceof ApiRequestError ? error.message : 'Check your connection and try again.',
      );
    },
  });

  return (
    <motion.section
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.2, ease: [0.05, 0.7, 0.1, 1] }}
      className="overflow-hidden border-t border-border-subtle"
      aria-label="Comments"
    >
      <div className="px-4 pt-3 pb-4">
        {isLoading && <div className="skeleton h-10 w-full" />}

        {!isLoading && data?.items.length === 0 && (
          <p className="mb-3 text-sm text-fg-subtle">No comments yet. Be the first.</p>
        )}

        <ul className="mb-3 flex flex-col gap-3">
          {data?.items.map((comment) => (
            <li key={comment.id} className="flex gap-2.5">
              <Avatar
                name={comment.author.name}
                src={comment.author.avatarUrl}
                size="xs"
                shape={comment.author.kind === 'company' ? 'rounded' : 'circle'}
                verified={comment.author.isVerified}
              />
              <div className="min-w-0 flex-1 rounded-xl bg-surface-sunken px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <p className="truncate text-xs font-semibold text-fg">{comment.author.name}</p>
                  <span className="shrink-0 text-2xs text-fg-faint">
                    {relativeTime(comment.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm leading-snug whitespace-pre-wrap text-fg-muted">
                  {comment.body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {account && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const body = draft.trim();
              if (body && !add.isPending) add.mutate(body);
            }}
            className="flex items-end gap-2"
          >
            <Avatar name={account.displayName} src={account.photoUrl} size="xs" />
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1500}
              placeholder="Write a comment…"
              aria-label="Write a comment"
              className="h-10 min-w-0 flex-1 rounded-xl border border-border-default bg-surface px-3 text-sm placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
            />
            <IconButton
              type="submit"
              label="Post comment"
              icon={<Send />}
              size="sm"
              variant="primary"
              disabled={!draft.trim()}
              isLoading={add.isPending}
            />
          </form>
        )}
      </div>
    </motion.section>
  );
}
