import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, BellOff, Check, Send, ShieldAlert, X } from 'lucide-react';
import type { Message, Thread } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button, IconButton } from '@/components/ui/button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { MentionInput } from '@/components/ui/mention-input';
import { RichText } from '@/components/ui/rich-text';
import { cn } from '@/lib/cn';
import { dayLabel, relativeTime } from '@/lib/format';
import { messagingApi, queryKeys } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';
import { useRealtimeMessages } from './use-realtime';

export function ThreadView() {
  const { threadId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { account } = useSession();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: thread } = useQuery({
    queryKey: queryKeys.thread(threadId),
    queryFn: () => messagingApi.getThread(threadId),
    enabled: Boolean(threadId),
  });

  const { data: messages, isLoading } = useQuery({
    queryKey: queryKeys.messages(threadId),
    queryFn: () => messagingApi.listMessages(threadId),
    enabled: Boolean(threadId),
    // The Firestore listener below is the live path and writes straight into
    // this cache key. The slow interval is only a safety net for when the
    // subscription cannot start (rules mismatch, blocked third-party storage).
    refetchInterval: 60_000,
  });

  // Realtime: the thread updates the instant the other side sends.
  useRealtimeMessages(threadId);

  const send = useMutation({
    mutationFn: (body: string) => messagingApi.sendMessage(threadId, body),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages(threadId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inboxSummary });
    },
    onError: (error) => {
      toast.error(
        'Message not sent',
        error instanceof ApiRequestError ? error.message : 'Check your connection and try again.',
      );
    },
  });

  const respond = useMutation({
    mutationFn: ({ accept, block }: { accept: boolean; block: boolean }) =>
      messagingApi.respondToRequest(threadId, accept, block),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
      toast.success(
        variables.block ? 'Blocked' : variables.accept ? 'Request accepted' : 'Request declined',
      );
      if (!variables.accept) navigate('/messages');
    },
  });

  // Mark read whenever the thread is opened or new messages land.
  useEffect(() => {
    if (!threadId || !messages?.items.length) return;
    void messagingApi.markRead(threadId).then(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inboxSummary });
    });
  }, [threadId, messages?.items.length, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.items.length]);

  const other = useMemo(
    () => thread?.participants.find((p) => p.accountId !== account?.id) ?? null,
    [thread, account],
  );

  if (!thread || !account) {
    return (
      <div className="p-6">
        <div className="skeleton h-16 w-full" />
      </div>
    );
  }

  const isPendingRequest = thread.state === 'request';
  const isIncomingRequest = isPendingRequest && thread.initiatedBy !== account.id;
  const isOutgoingRequest = isPendingRequest && thread.initiatedBy === account.id;
  const isClosed = thread.state === 'blocked' || thread.state === 'declined';

  /**
   * The thread is exactly one viewport tall, minus both bars.
   *
   * It used to subtract only the header, so the composer — the last row of the
   * column — landed at the very bottom of the screen, which is precisely where
   * the fixed bottom nav sits. The input was there and typable, just covered.
   * `--shell-nav` is 0 from `lg` up, where the nav becomes a rail, so one calc
   * serves both layouts.
   */
  return (
    <div className="flex h-[calc(100dvh-var(--shell-header)-var(--shell-nav))] flex-col">
      {/* ------------------------------------------------------- header -- */}
      <header className="flex items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
        <IconButton
          label="Back to inbox"
          icon={<ArrowLeft />}
          size="sm"
          onClick={() => navigate('/messages')}
          className="lg:hidden"
        />
        <Avatar name={other?.name ?? 'Unknown'} src={other?.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{other?.name ?? 'Unknown'}</p>
          {other?.headline && (
            <p className="truncate text-xs text-fg-subtle">{other.headline}</p>
          )}
        </div>
        <IconButton
          label={thread.mutedBy.includes(account.id) ? 'Unmute conversation' : 'Mute conversation'}
          icon={<BellOff />}
          size="sm"
          onClick={() => {
            const muted = !thread.mutedBy.includes(account.id);
            void messagingApi.setMuted(threadId, muted).then(() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.thread(threadId) });
              toast.info(muted ? 'Conversation muted' : 'Conversation unmuted');
            });
          }}
          className={cn(thread.mutedBy.includes(account.id) && 'text-brand-fg')}
        />
      </header>

      {/* ----------------------------------------------------- messages -- */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading && <div className="skeleton h-20 w-2/3" />}

        {isOutgoingRequest && (
          <Alert variant="info" className="mb-4">
            This is a message request. {other?.name?.split(' ')[0] ?? 'They'} will need to accept
            before you can send anything else.
          </Alert>
        )}

        {messages?.items.map((message, index) => {
          const previous = messages.items[index - 1];
          const showDay =
            !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
          return (
            <div key={message.id}>
              {showDay && (
                <div className="my-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border-default" />
                  <span className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">
                    {dayLabel(message.createdAt)}
                  </span>
                  <span className="h-px flex-1 bg-border-default" />
                </div>
              )}
              <MessageBubble message={message} isOwn={message.senderId === account.id} />
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* ------------------------------------------------------- footer -- */}
      {isIncomingRequest ? (
        <div className="border-t border-border-subtle bg-surface p-4 lg:pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <p className="mb-3 text-sm text-fg-muted">
            <span className="font-medium text-fg">{other?.name}</span> wants to message you. Accept
            to reply, or decline and they will not be able to write again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              leftIcon={<Check />}
              onClick={() => respond.mutate({ accept: true, block: false })}
              isLoading={respond.isPending}
            >
              Accept
            </Button>
            <Button
              variant="outline"
              leftIcon={<X />}
              onClick={() => respond.mutate({ accept: false, block: false })}
            >
              Decline
            </Button>
            <Button
              variant="ghost"
              leftIcon={<ShieldAlert />}
              onClick={() => respond.mutate({ accept: false, block: true })}
              className="text-danger-fg"
            >
              Decline &amp; block
            </Button>
          </div>
        </div>
      ) : isClosed ? (
        <div className="border-t border-border-subtle bg-surface-sunken p-4 text-center text-sm text-fg-subtle lg:pb-[calc(1rem+env(safe-area-inset-bottom))]">
          This conversation is closed.
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const body = draft.trim();
            if (!body || send.isPending) return;
            send.mutate(body);
          }}
          // The home-indicator inset is only the composer's problem from `lg`
          // up. Below that the bottom nav sits underneath it and is already
          // padding for the inset — adding it here too left a dead 34px strip.
          className="flex items-end gap-2 border-t border-border-subtle bg-surface p-3 lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          {/* Enter sends and Shift+Enter breaks the line — the convention every
              messaging app has trained people on. `MentionInput` owns Enter
              while its `@` picker is open, so a tag is chosen rather than sent. */}
          <MentionInput
            value={draft}
            onChange={setDraft}
            submitOnEnter
            onSubmit={() => {
              const body = draft.trim();
              if (body && !send.isPending) send.mutate(body);
            }}
            rows={1}
            placeholder={isOutgoingRequest ? 'Waiting for them to accept…' : 'Write a message…'}
            disabled={isOutgoingRequest || send.isPending}
            aria-label="Message"
            className="max-h-32 min-h-11 w-full resize-none rounded-xl border border-border-default bg-surface px-3.5 py-2.5 text-base placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none disabled:bg-surface-sunken disabled:text-fg-faint"
          />
          <IconButton
            type="submit"
            label="Send message"
            icon={<Send />}
            variant="primary"
            disabled={!draft.trim() || isOutgoingRequest}
            isLoading={send.isPending}
          />
        </form>
      )}
    </div>
  );
}

function MessageBubble({ message, isOwn }: { message: Message; isOwn: boolean }) {
  return (
    <div className={cn('mb-2 flex', isOwn ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[78%]', isOwn && 'items-end')}>
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words',
            isOwn
              ? 'rounded-br-md bg-brand text-fg-on-brand'
              : 'rounded-bl-md bg-surface-sunken text-fg',
          )}
        >
          <RichText body={message.body} mentions={message.mentions ?? []} />
        </div>

        {/* FR-1101 — the recipient is warned, but the message is not hidden.
            Silently swallowing it would be worse: they would never learn the
            pattern to watch for. */}
        {message.isFlagged && (
          <p className="mt-1 flex items-center gap-1.5 text-2xs font-medium text-warning-fg">
            <AlertTriangle aria-hidden="true" className="size-3" />
            Flagged for review — never send money or bank details
          </p>
        )}

        <p
          className={cn(
            'mt-1 flex items-center gap-1 text-2xs text-fg-faint',
            isOwn && 'justify-end',
          )}
        >
          {relativeTime(message.createdAt)}
          {isOwn && message.readBy.length > 1 && (
            <>
              <Check aria-hidden="true" className="size-3" />
              <span className="sr-only">Read</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export function ThreadPlaceholder() {
  return (
    <EmptyState
      icon={<Send />}
      title="Pick a conversation"
      description="Select a thread from the list to read it here."
      className="hidden h-full lg:flex"
    />
  );
}

export type { Thread };
