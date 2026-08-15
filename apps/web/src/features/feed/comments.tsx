import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Flag, Heart, Send, Trash2 } from 'lucide-react';
import type { PostCommentThread, PostCommentView } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/button';
import { MentionInput } from '@/components/ui/mention-input';
import { ReportDialog } from '@/components/ui/report-dialog';
import { RichText } from '@/components/ui/rich-text';
import { cn } from '@/lib/cn';
import { compactCount, relativeTime } from '@/lib/format';
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
export function Comments({
  postId,
  cacheKey,
  viewerId,
}: {
  postId: string;
  /** The list cache whose comment counts need refreshing after a write. */
  cacheKey: QueryKey;
  viewerId: string;
}) {
  const { account } = useSession();
  const queryClient = useQueryClient();
  const composerRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState('');
  // Which comment the composer is currently answering. Null is a new top-level
  // comment.
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.comments(postId),
    queryFn: () => feedApi.listComments(postId),
  });

  const add = useMutation({
    mutationFn: (body: string) =>
      feedApi.addComment(postId, { body, parentCommentId: replyingTo?.id ?? null, mentions: [] }),
    onSuccess: () => {
      setDraft('');
      setReplyingTo(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(postId) });
      // The post's commentCount lives on the feed item, so that cache needs
      // refreshing too or the button keeps showing the old number.
      void queryClient.invalidateQueries({ queryKey: cacheKey });
    },
    onError: (error) => {
      toast.error(
        'Comment not posted',
        error instanceof ApiRequestError ? error.message : 'Check your connection and try again.',
      );
    },
  });

  /**
   * Likes update in place rather than refetching the thread.
   *
   * A refetch would re-render every comment and lose the reader's scroll
   * position — a lot of disruption for a number changing by one.
   */
  const like = useMutation({
    mutationFn: (commentId: string) => feedApi.toggleCommentReaction(postId, commentId),
    onMutate: async (commentId: string) => {
      const key = queryKeys.comments(postId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ items: PostCommentThread[] }>(key);

      const toggle = (comment: PostCommentView): PostCommentView =>
        comment.id === commentId
          ? {
              ...comment,
              hasLiked: !comment.hasLiked,
              likeCount: comment.likeCount + (comment.hasLiked ? -1 : 1),
            }
          : comment;

      queryClient.setQueryData<{ items: PostCommentThread[] }>(key, (old) =>
        old
          ? {
              items: old.items.map((thread) => ({
                ...toggle(thread),
                replies: thread.replies.map(toggle),
              })),
            }
          : old,
      );

      return { previous };
    },
    onError: (_error, _commentId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.comments(postId), context.previous);
      }
      toast.error('Could not save that', 'Check your connection.');
    },
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => feedApi.deleteComment(postId, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(postId) });
      void queryClient.invalidateQueries({ queryKey: cacheKey });
    },
    onError: () => toast.error('Could not delete that comment'),
  });

  function startReply(commentId: string, name: string): void {
    setReplyingTo({ id: commentId, name });
    // Prefilling the handle is what makes a reply read like a reply in the
    // flattened list, and it registers as a real tag rather than plain text.
    setDraft((current) => (current.includes(`@${name}`) ? current : `@${name} `));
    composerRef.current?.querySelector('input')?.focus();
  }

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
          {data?.items.map((thread) => (
            <li key={thread.id}>
              <CommentThreadRow
                thread={thread}
                viewerId={viewerId}
                onLike={like.mutate}
                onReply={startReply}
                onDelete={remove.mutate}
              />
            </li>
          ))}
        </ul>

        {account && (
          <form
            ref={composerRef}
            onSubmit={(e) => {
              e.preventDefault();
              const body = draft.trim();
              if (body && !add.isPending) add.mutate(body);
            }}
          >
            {replyingTo && (
              <p className="mb-1.5 flex items-center gap-2 text-xs text-fg-subtle">
                Replying to <span className="font-medium text-fg">{replyingTo.name}</span>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="cursor-pointer font-medium text-brand-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  Cancel
                </button>
              </p>
            )}

            <div className="flex items-end gap-2">
              <Avatar name={account.displayName} src={account.photoUrl} size="xs" />
              <MentionInput
                multiline={false}
                value={draft}
                onChange={setDraft}
                maxLength={1500}
                placeholder={replyingTo ? `Reply to ${replyingTo.name}…` : 'Write a comment…'}
                aria-label={replyingTo ? `Reply to ${replyingTo.name}` : 'Write a comment'}
                onSubmit={() => {
                  const body = draft.trim();
                  if (body && !add.isPending) add.mutate(body);
                }}
                className="h-10 w-full min-w-0 rounded-xl border border-border-default bg-surface px-3 text-sm placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
              />
              <IconButton
                type="submit"
                label={replyingTo ? 'Post reply' : 'Post comment'}
                icon={<Send />}
                size="sm"
                variant="primary"
                disabled={!draft.trim()}
                isLoading={add.isPending}
              />
            </div>
          </form>
        )}
      </div>
    </motion.section>
  );
}

/**
 * A top-level comment and its replies, collapsed behind a disclosure.
 *
 * Replies used to render expanded and unbounded, which meant one argument
 * buried every other comment on the post. Collapsing them is what Instagram and
 * YouTube both do, and for the same reason: the top-level comments are the
 * conversation, the replies are a sub-conversation, and only the person who
 * cares about one of them should have to scroll past it.
 */
function CommentThreadRow({
  thread,
  viewerId,
  onLike,
  onReply,
  onDelete,
}: {
  thread: PostCommentThread;
  viewerId: string;
  onLike: (commentId: string) => void;
  onReply: (parentId: string, name: string) => void;
  onDelete: (commentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const replyCount = thread.replies.length || thread.replyCount;

  return (
    <>
      <CommentRow
        comment={thread}
        viewerId={viewerId}
        onLike={() => onLike(thread.id)}
        onReply={() => onReply(thread.id, thread.author.name)}
        onDelete={() => onDelete(thread.id)}
      />

      {replyCount > 0 && (
        <div className="mt-1.5 ml-9">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-2xs font-semibold text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            {expanded ? (
              <ChevronUp aria-hidden="true" className="size-3.5" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3.5" />
            )}
            {expanded
              ? 'Hide replies'
              : `View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
          </button>

          {expanded && thread.replies.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2.5 border-l border-border-subtle pl-3">
              {thread.replies.map((reply) => (
                <li key={reply.id}>
                  <CommentRow
                    comment={reply}
                    viewerId={viewerId}
                    onLike={() => onLike(reply.id)}
                    // Replying to a reply attaches to the same parent, so the
                    // thread never nests past one level.
                    onReply={() => onReply(thread.id, reply.author.name)}
                    onDelete={() => onDelete(reply.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function CommentRow({
  comment,
  viewerId,
  onLike,
  onReply,
  onDelete,
}: {
  comment: PostCommentView;
  viewerId: string;
  onLike: () => void;
  onReply: () => void;
  onDelete: () => void;
}) {
  const isPerson = comment.author.kind === 'account';
  const isMine = comment.authorAccountId === viewerId;
  const [reporting, setReporting] = useState(false);

  return (
    <div className="flex gap-2.5">
      {isPerson ? (
        <Link
          to={`/u/${comment.author.id}`}
          aria-label={`${comment.author.name}'s profile`}
          className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <Avatar
            name={comment.author.name}
            src={comment.author.avatarUrl}
            size="xs"
            verified={comment.author.isVerified}
          />
        </Link>
      ) : (
        <Avatar
          name={comment.author.name}
          src={comment.author.avatarUrl}
          size="xs"
          shape="rounded"
          verified={comment.author.isVerified}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="rounded-xl bg-surface-sunken px-3 py-2">
          <div className="flex items-baseline gap-2">
            {isPerson ? (
              <Link
                to={`/u/${comment.author.id}`}
                className="truncate text-xs font-semibold text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
              >
                {comment.author.name}
              </Link>
            ) : (
              <p className="truncate text-xs font-semibold text-fg">{comment.author.name}</p>
            )}
            <span className="shrink-0 text-2xs text-fg-faint">
              {relativeTime(comment.createdAt)}
            </span>
          </div>
          <RichText
            body={comment.body}
            mentions={comment.mentions ?? []}
            className="mt-0.5 text-sm leading-snug text-fg-muted"
          />
        </div>

        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={onLike}
            aria-pressed={comment.hasLiked}
            className={cn(
              'flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-2xs font-semibold transition-colors duration-[160ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              comment.hasLiked
                ? 'text-accent-fg hover:bg-accent-subtle'
                : 'text-fg-subtle hover:bg-surface-sunken hover:text-fg',
            )}
          >
            <Heart
              aria-hidden="true"
              className="size-3.5"
              fill={comment.hasLiked ? 'currentColor' : 'none'}
            />
            {comment.likeCount > 0 && compactCount(comment.likeCount)}
            <span className="sr-only">{comment.hasLiked ? 'Unlike comment' : 'Like comment'}</span>
          </button>

          <button
            type="button"
            onClick={onReply}
            className="flex h-7 cursor-pointer items-center rounded-md px-1.5 text-2xs font-semibold text-fg-subtle transition-colors duration-[160ms] hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            Reply
          </button>

          {isMine ? (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete comment"
              className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-faint transition-colors duration-[160ms] hover:bg-danger-subtle hover:text-danger-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setReporting(true)}
              aria-label="Report comment"
              className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-faint transition-colors duration-[160ms] hover:bg-danger-subtle hover:text-danger-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Flag aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {reporting && (
        <ReportDialog
          targetType="comment"
          targetId={comment.id}
          // A comment lives under its post, so the moderator needs both IDs.
          parentId={comment.postId}
          subject={`${comment.author.name}’s comment`}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}
