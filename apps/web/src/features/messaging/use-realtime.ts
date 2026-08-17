import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Message, Presence, Thread } from '@internlink/shared-types';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { queryKeys } from '@/lib/api-endpoints';
import { api } from '@/lib/api-client';

/**
 * Realtime messaging via Firestore listeners.
 *
 * This is the read half of the architecture: writes still go through the API
 * (which validates, rate-limits, scans for scam patterns and emits events),
 * while reads come straight from Firestore so a thread updates the instant the
 * other person sends something.
 *
 * Security rules make this safe — `messageThreads` and its `messages`
 * subcollection are readable only by a participant, and every write is denied
 * to clients outright. See firestore.rules.
 *
 * The listeners write into the React Query cache rather than into component
 * state, so the rest of the app keeps reading from one place and nothing has to
 * know whether a given render came from a fetch or a snapshot.
 */

/** Firestore Timestamps arrive as objects; the API contract says ISO strings. */
function toIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

/**
 * Subscribes to one thread's messages.
 *
 * Ordered descending with a cap, then reversed for display — the same shape the
 * REST endpoint returns, so switching between them changes nothing downstream.
 */
export function useRealtimeMessages(threadId: string | undefined, enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!threadId || !enabled || !isFirebaseConfigured) return;

    let unsubscribe: Unsubscribe | undefined;

    try {
      unsubscribe = onSnapshot(
        query(
          collection(db(), 'messageThreads', threadId, 'messages'),
          orderBy('createdAt', 'desc'),
          limit(60),
        ),
        (snapshot) => {
          const items: Message[] = snapshot.docs
            .map((doc) => {
              const data = doc.data();
              return {
                id: doc.id,
                threadId,
                senderId: data.senderId as string,
                body: (data.body as string) ?? '',
                // Absent on every message written before tagging shipped.
                mentions: (data.mentions as Message['mentions']) ?? [],
                attachments: (data.attachments as Message['attachments']) ?? [],
                sticker: (data.sticker as Message['sticker']) ?? null,
                replyTo: (data.replyTo as Message['replyTo']) ?? null,
                readBy: (data.readBy as string[]) ?? [],
                isFlagged: Boolean(data.isFlagged),
                flagReasons: (data.flagReasons as string[]) ?? [],
                editedAt: data.editedAt ? toIso(data.editedAt) : null,
                deletedAt: data.deletedAt ? toIso(data.deletedAt) : null,
                createdAt: toIso(data.createdAt),
              };
            })
            .reverse();

          queryClient.setQueryData(queryKeys.messages(threadId), {
            items,
            nextCursor: null,
            hasMore: snapshot.docs.length >= 60,
          });
        },
        (error) => {
          // A permission-denied here means the rules and the participant list
          // disagree — worth seeing in the console, but not worth breaking the
          // screen over. The REST fetch remains as the fallback path.
          console.warn('Realtime messages unavailable, falling back to polling', error);
        },
      );
    } catch (error) {
      console.warn('Could not subscribe to messages', error);
    }

    return () => unsubscribe?.();
  }, [threadId, enabled, queryClient]);
}

export function useRealtimePresence(
  accountId: string | undefined,
  enabled = true,
): Presence | null {
  const [presence, setPresence] = useState<Presence | null>(null);

  useEffect(() => {
    if (!accountId || !enabled || !isFirebaseConfigured) {
      setPresence(null);
      return;
    }

    let unsubscribe: Unsubscribe | undefined;

    try {
      unsubscribe = onSnapshot(
        doc(db(), 'presence', accountId),
        (snapshot) => {
          if (!snapshot.exists()) {
            setPresence(null);
            return;
          }
          const data = snapshot.data();
          setPresence({
            accountId,
            lastActiveAt: toIso(data.lastActiveAt),
          });
        },
        (error) => {
          console.warn('Realtime presence unavailable', error);
        },
      );
    } catch (error) {
      console.warn('Could not subscribe to presence', error);
    }

    return () => unsubscribe?.();
  }, [accountId, enabled]);

  return presence;
}

export function usePresenceHeartbeat(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    const touch = () => {
      if (stopped || document.visibilityState === 'hidden') return;
      void api.post<{ lastActiveAt: string }>('/auth/presence').catch(() => undefined);
    };

    touch();
    const interval = window.setInterval(touch, 45_000);
    window.addEventListener('focus', touch);
    document.addEventListener('visibilitychange', touch);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', touch);
      document.removeEventListener('visibilitychange', touch);
    };
  }, [enabled]);
}

/**
 * Subscribes to the signed-in user's threads, so the inbox and its unread badge
 * update without polling.
 *
 * Needs the composite index on (participantIds, updatedAt) — declared in
 * firestore.indexes.json.
 */
export function useRealtimeThreads(accountId: string | undefined, enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!accountId || !enabled || !isFirebaseConfigured) return;

    let unsubscribe: Unsubscribe | undefined;

    try {
      unsubscribe = onSnapshot(
        query(
          collection(db(), 'messageThreads'),
          where('participantIds', 'array-contains', accountId),
          orderBy('updatedAt', 'desc'),
          limit(50),
        ),
        (snapshot) => {
          const threads: Thread[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              kind: (data.kind as Thread['kind']) ?? 'direct',
              state: (data.state as Thread['state']) ?? 'accepted',
              participantIds: (data.participantIds as string[]) ?? [],
              participants: (data.participants as Thread['participants']) ?? [],
              applicationId: (data.applicationId as string | null) ?? null,
              listingId: (data.listingId as string | null) ?? null,
              title: (data.title as string | null) ?? null,
              initiatedBy: data.initiatedBy as string,
              lastMessage: data.lastMessage
                ? {
                    ...(data.lastMessage as Record<string, unknown>),
                    sentAt: toIso((data.lastMessage as Record<string, unknown>).sentAt),
                  }
                : null,
              unread: (data.unread as Record<string, number>) ?? {},
              mutedBy: (data.mutedBy as string[]) ?? [],
              createdAt: toIso(data.createdAt),
              updatedAt: toIso(data.updatedAt),
            } as Thread;
          });

          // Split into the two inboxes here rather than filtering at render:
          // the screens read whichever key matches the tab they are showing.
          for (const box of ['primary', 'requests'] as const) {
            const items = threads.filter((t) =>
              box === 'requests'
                ? t.state === 'request' && t.initiatedBy !== accountId
                : t.state === 'accepted',
            );
            queryClient.setQueryData(queryKeys.threads(box), {
              items,
              nextCursor: null,
              hasMore: false,
            });
          }

          const primary = threads.filter((t) => t.state === 'accepted');
          queryClient.setQueryData(queryKeys.inboxSummary, {
            unreadThreads: primary.filter((t) => (t.unread[accountId] ?? 0) > 0).length,
            unreadMessages: primary.reduce((sum, t) => sum + (t.unread[accountId] ?? 0), 0),
            pendingRequests: threads.filter(
              (t) => t.state === 'request' && t.initiatedBy !== accountId,
            ).length,
          });
        },
        (error) => {
          console.warn('Realtime threads unavailable, falling back to polling', error);
        },
      );
    } catch (error) {
      console.warn('Could not subscribe to threads', error);
    }

    return () => unsubscribe?.();
  }, [accountId, enabled, queryClient]);
}
