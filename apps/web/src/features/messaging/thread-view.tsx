import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  BellOff,
  Check,
  CheckCheck,
  FileText,
  Loader2,
  Mic,
  Reply,
  Send,
  ShieldAlert,
  Smile,
  Square,
  X,
} from 'lucide-react';
import type {
  Attachment,
  Message,
  MessageSticker,
  SendMessageInput,
  Thread,
} from '@internlink/shared-types';
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
import { uploadDocument } from '@/lib/cloudinary';
import { useUploadCapabilities } from '@/hooks/use-uploads-available';
import {
  usePresenceHeartbeat,
  useRealtimeMessages,
  useRealtimePresence,
} from './use-realtime';

const STICKERS: MessageSticker[] = [
  { id: 'wave', emoji: '👋', label: 'Wave' },
  { id: 'yes', emoji: '✅', label: 'Approved' },
  { id: 'party', emoji: '🎉', label: 'Celebrate' },
  { id: 'thanks', emoji: '🙏', label: 'Thanks' },
  { id: 'heart', emoji: '❤️', label: 'Love it' },
  { id: 'fire', emoji: '🔥', label: 'Great work' },
  { id: 'star', emoji: '⭐', label: 'Starred' },
  { id: 'clap', emoji: '🙌', label: 'Well done' },
];

export function ThreadView() {
  const { threadId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { account } = useSession();
  const [draft, setDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [isStickerOpen, setIsStickerOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceProgress, setVoiceProgress] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const recordingStartedAt = useRef<number>(0);
  const shouldUploadVoiceRef = useRef(false);
  const { capabilities, isLoading: uploadsLoading } = useUploadCapabilities();

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
  usePresenceHeartbeat(Boolean(account));

  const send = useMutation({
    mutationFn: (input: SendMessageInput) => messagingApi.sendMessage(threadId, input),
    onSuccess: () => {
      setDraft('');
      setReplyTarget(null);
      setIsStickerOpen(false);
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
  const otherPresence = useRealtimePresence(other?.accountId);
  const presence = presenceLabel(otherPresence?.lastActiveAt);

  const participantNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const participant of thread?.participants ?? []) {
      names.set(participant.accountId, participant.name);
    }
    return names;
  }, [thread]);

  function buildInput(overrides: Partial<SendMessageInput> = {}): SendMessageInput {
    return {
      body: draft.trim(),
      attachments: [],
      sticker: null,
      replyToMessageId: replyTarget?.id ?? null,
      ...overrides,
    };
  }

  async function startRecording(): Promise<void> {
    if (send.isPending || voiceProgress !== null || isRecording) return;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast.error('Voice notes are not available in this browser');
      return;
    }
    if (!uploadsLoading && !capabilities.available) {
      toast.error('Voice uploads are not switched on yet');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      shouldUploadVoiceRef.current = true;
      recordingStartedAt.current = Date.now();
      setRecordingSeconds(0);
      setIsRecording(true);

      timerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.max(1, Math.round((Date.now() - recordingStartedAt.current) / 1000)));
      }, 500);

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });

      recorder.addEventListener('stop', () => {
        if (!shouldUploadVoiceRef.current) return;
        void uploadRecordedVoice(recorder.mimeType || 'audio/webm');
      });

      recorder.start();
    } catch (error) {
      stopRecordingResources();
      setIsRecording(false);
      toast.error(
        'Could not record audio',
        error instanceof Error ? error.message : 'Check your microphone permission.',
      );
    }
  }

  function stopRecording(): void {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return;
    shouldUploadVoiceRef.current = true;
    recorderRef.current.stop();
    stopRecordingResources();
    setIsRecording(false);
  }

  function cancelRecording(): void {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      shouldUploadVoiceRef.current = false;
      recorderRef.current.stop();
    }
    chunksRef.current = [];
    stopRecordingResources();
    setIsRecording(false);
    setRecordingSeconds(0);
  }

  function stopRecordingResources(): void {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function uploadRecordedVoice(mimeType: string): Promise<void> {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    shouldUploadVoiceRef.current = false;
    if (chunks.length === 0) return;

    const duration = Math.max(1, Math.round((Date.now() - recordingStartedAt.current) / 1000));
    const blob = new Blob(chunks, { type: mimeType });
    const file = new File([blob], `voice-note-${Date.now()}.${extensionForMime(mimeType)}`, {
      type: mimeType,
    });

    setVoiceProgress(0);
    try {
      const { url } = await uploadDocument(file, 'message_voice', setVoiceProgress);
      send.mutate(
        buildInput({
          body: '',
          attachments: [
            {
              url,
              name: 'Voice note',
              mimeType: file.type || 'audio/webm',
              bytes: file.size,
              kind: 'voice',
              durationSeconds: duration,
            },
          ],
          sticker: null,
        }),
      );
    } catch (error) {
      toast.error(
        'Voice note not sent',
        error instanceof Error ? error.message : 'Try recording it again.',
      );
    } finally {
      setVoiceProgress(null);
      setRecordingSeconds(0);
    }
  }

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        shouldUploadVoiceRef.current = false;
        recorderRef.current.stop();
      }
      stopRecordingResources();
    };
  }, []);

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
          <p className="flex min-h-4 items-center gap-1.5 truncate text-xs text-fg-subtle">
            {presence && (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    presence.isOnline ? 'bg-success' : 'bg-fg-faint',
                  )}
                />
                <span>{presence.label}</span>
              </>
            )}
            {!presence && other?.headline && <span className="truncate">{other.headline}</span>}
          </p>
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
              <MessageBubble
                message={message}
                isOwn={message.senderId === account.id}
                isRead={(message.readBy ?? []).some((id) => id !== message.senderId)}
                senderName={participantNames.get(message.senderId) ?? 'Someone'}
                participantNames={participantNames}
                onReply={() => setReplyTarget(message)}
              />
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
        <div className="border-t border-border-subtle bg-surface p-3 lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {replyTarget && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-sunken px-3 py-2">
              <Reply aria-hidden="true" className="size-4 shrink-0 text-brand-fg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-fg">
                  Replying to {replyTarget.senderId === account.id ? 'your message' : (other?.name ?? 'message')}
                </p>
                <p className="truncate text-xs text-fg-subtle">{messageSummary(replyTarget)}</p>
              </div>
              <IconButton
                label="Cancel reply"
                icon={<X />}
                size="sm"
                onClick={() => setReplyTarget(null)}
              />
            </div>
          )}

          {isStickerOpen && (
            <div className="mb-2 grid grid-cols-4 gap-2 rounded-xl border border-border-subtle bg-surface-sunken p-2 sm:grid-cols-8">
              {STICKERS.map((sticker) => (
                <button
                  key={sticker.id}
                  type="button"
                  disabled={send.isPending || isOutgoingRequest}
                  onClick={() =>
                    send.mutate(buildInput({ body: '', attachments: [], sticker }))
                  }
                  className="flex h-12 cursor-pointer items-center justify-center rounded-lg bg-surface text-2xl transition-colors hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span aria-hidden="true">{sticker.emoji}</span>
                  <span className="sr-only">{sticker.label}</span>
                </button>
              ))}
            </div>
          )}

          {isRecording && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-danger-subtle bg-danger-subtle px-3 py-2 text-danger-fg">
              <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
              <span className="text-sm font-semibold tabular-nums">{formatDuration(recordingSeconds)}</span>
              <span className="text-sm">Recording</span>
              <IconButton
                label="Cancel voice note"
                icon={<X />}
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={cancelRecording}
              />
              <IconButton
                label="Send voice note"
                icon={<Square />}
                size="sm"
                variant="danger"
                onClick={stopRecording}
              />
            </div>
          )}

          {voiceProgress !== null && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-sm text-fg-subtle">
              <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
              <span className="tabular-nums">Uploading voice note... {voiceProgress}%</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim() || send.isPending) return;
              send.mutate(buildInput());
            }}
            // The home-indicator inset is only the composer's problem from `lg`
            // up. Below that the bottom nav sits underneath it and is already
            // padding for the inset — adding it here too left a dead 34px strip.
            className="flex items-end gap-2"
          >
            <IconButton
              label="Stickers"
              icon={<Smile />}
              disabled={isOutgoingRequest || send.isPending || isRecording}
              onClick={() => setIsStickerOpen((open) => !open)}
              className={cn(isStickerOpen && 'bg-brand-subtle text-brand-fg')}
            />
            <IconButton
              label={isRecording ? 'Recording voice note' : 'Record voice note'}
              icon={<Mic />}
              disabled={isOutgoingRequest || send.isPending || isRecording || voiceProgress !== null}
              onClick={() => void startRecording()}
            />
            {/* Enter sends and Shift+Enter breaks the line — the convention every
                messaging app has trained people on. `MentionInput` owns Enter
                while its `@` picker is open, so a tag is chosen rather than sent. */}
            <MentionInput
              value={draft}
              onChange={setDraft}
              submitOnEnter
              onSubmit={() => {
                if (draft.trim() && !send.isPending) send.mutate(buildInput());
              }}
              rows={1}
              placeholder={isOutgoingRequest ? 'Waiting for them to accept…' : 'Write a message…'}
              disabled={isOutgoingRequest || send.isPending || isRecording}
              aria-label="Message"
              className="max-h-32 min-h-11 w-full resize-none rounded-xl border border-border-default bg-surface px-3.5 py-2.5 text-base placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none disabled:bg-surface-sunken disabled:text-fg-faint"
            />
            <IconButton
              type="submit"
              label="Send message"
              icon={<Send />}
              variant="primary"
              disabled={!draft.trim() || isOutgoingRequest || isRecording}
              isLoading={send.isPending}
            />
          </form>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isOwn,
  isRead,
  senderName,
  participantNames,
  onReply,
}: {
  message: Message;
  isOwn: boolean;
  isRead: boolean;
  senderName: string;
  participantNames: Map<string, string>;
  onReply: () => void;
}) {
  const [dragX, setDragX] = useState(0);
  const startX = useRef<number | null>(null);
  const attachments = message.attachments ?? [];

  function resetDrag() {
    startX.current = null;
    setDragX(0);
  }

  return (
    <div className={cn('mb-2 flex', isOwn ? 'justify-end' : 'justify-start')}>
      <div className={cn('group max-w-[82%]', isOwn && 'items-end')}>
        <div
          onPointerDown={(event) => {
            startX.current = event.clientX;
          }}
          onPointerMove={(event) => {
            if (startX.current === null) return;
            setDragX(Math.max(0, Math.min(72, event.clientX - startX.current)));
          }}
          onPointerUp={() => {
            if (dragX > 52) onReply();
            resetDrag();
          }}
          onPointerCancel={resetDrag}
          style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
          className={cn(
            'relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words transition-transform duration-[120ms]',
            isOwn
              ? 'rounded-br-md bg-brand text-fg-on-brand'
              : 'rounded-bl-md bg-surface-sunken text-fg',
          )}
        >
          {dragX > 8 && (
            <span
              aria-hidden="true"
              className="absolute top-1/2 -left-8 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-brand-subtle text-brand-fg"
            >
              <Reply className="size-3.5" />
            </span>
          )}

          {message.replyTo && (
            <div
              className={cn(
                'mb-2 rounded-lg border-l-2 px-2.5 py-1.5',
                isOwn
                  ? 'border-white/70 bg-white/15 text-white/85'
                  : 'border-brand bg-surface text-fg-subtle',
              )}
            >
              <p className="truncate text-2xs font-semibold">
                {message.replyTo.senderId === message.senderId
                  ? senderName
                  : (participantNames.get(message.replyTo.senderId) ?? 'Message')}
              </p>
              <p className="truncate text-xs">{replyPreviewText(message.replyTo)}</p>
            </div>
          )}

          {message.sticker && (
            <div className="flex min-w-28 flex-col items-center gap-1 py-1">
              <span aria-hidden="true" className="text-5xl leading-none">
                {message.sticker.emoji}
              </span>
              <span className="text-xs font-medium opacity-80">{message.sticker.label}</span>
            </div>
          )}

          {message.body && <RichText body={message.body} mentions={message.mentions ?? []} />}

          {attachments.length > 0 && (
            <div className={cn(message.body && 'mt-2', 'space-y-2')}>
              {attachments.map((attachment) => (
                <MessageAttachment key={attachment.url} attachment={attachment} isOwn={isOwn} />
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onReply}
          className={cn(
            'mt-1 hidden cursor-pointer items-center gap-1 text-2xs font-medium text-fg-faint underline-offset-4 hover:text-fg-muted hover:underline focus-visible:inline-flex group-hover:inline-flex',
            isOwn && 'ml-auto',
          )}
        >
          <Reply aria-hidden="true" className="size-3" />
          Reply
        </button>

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
          {isOwn && (
            <>
              {isRead ? (
                <CheckCheck aria-hidden="true" className="size-3" />
              ) : (
                <Check aria-hidden="true" className="size-3" />
              )}
              <span>{isRead ? 'Read' : 'Sent'}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function MessageAttachment({ attachment, isOwn }: { attachment: Attachment; isOwn: boolean }) {
  if (attachment.kind === 'voice') {
    return (
      <div
        className={cn(
          'min-w-56 rounded-xl px-2.5 py-2',
          isOwn ? 'bg-white/15' : 'bg-surface',
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium opacity-85">
          <span>Voice note</span>
          {attachment.durationSeconds && (
            <span className="tabular-nums">{formatDuration(attachment.durationSeconds)}</span>
          )}
        </div>
        <audio controls preload="metadata" src={attachment.url} className="h-9 w-full" />
      </div>
    );
  }

  if (attachment.kind === 'image') {
    return (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-h-72 rounded-xl border border-white/15 object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-2 text-sm underline-offset-4 hover:underline',
        isOwn ? 'bg-white/15' : 'bg-surface',
      )}
    >
      <FileText aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{attachment.name}</span>
    </a>
  );
}

function messageSummary(message: Message): string {
  if (message.body.trim()) return message.body.trim();
  if (message.sticker) return `${message.sticker.emoji} ${message.sticker.label}`;
  const attachment = (message.attachments ?? [])[0];
  if (attachment?.kind === 'voice') return 'Voice note';
  if (attachment?.kind === 'image') return 'Image attachment';
  if (attachment) return attachment.name;
  return 'Message';
}

function replyPreviewText(reply: NonNullable<Message['replyTo']>): string {
  if (reply.body) return reply.body;
  if (reply.sticker) return `${reply.sticker.emoji} ${reply.sticker.label}`;
  if (reply.attachmentKind === 'voice') return 'Voice note';
  if (reply.attachmentKind === 'image') return 'Image attachment';
  return 'Message';
}

function presenceLabel(lastActiveAt: string | undefined): { label: string; isOnline: boolean } | null {
  if (!lastActiveAt) return null;
  const last = Date.parse(lastActiveAt);
  if (!Number.isFinite(last)) return null;
  const isOnline = Date.now() - last < 90_000;
  return {
    isOnline,
    label: isOnline ? 'Online' : `Last seen ${relativeTime(lastActiveAt)}`,
  };
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
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
