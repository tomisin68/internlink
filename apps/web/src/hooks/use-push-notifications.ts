import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseApp, isFirebaseConfigured } from '@/lib/firebase';
import { pushApi } from '@/lib/api-endpoints';
import { isIosDevice, isStandalone } from '@/lib/pwa';
import { onSwMessage } from '@/lib/sw-bridge';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';

/** Remembered so a granted permission re-registers silently on the next visit. */
const STORAGE_KEY = 'internlink.push.token';
/** Set only when the user explicitly turns this device off inside InternLink. */
const DISABLED_STORAGE_KEY = 'internlink.push.disabled';

/**
 * `navigator.serviceWorker.ready` is a promise that never rejects: when
 * registration has failed there is simply no active worker and it hangs
 * forever. Awaiting it bare left "Turn on" spinning with nothing to show.
 */
const SW_READY_TIMEOUT_MS = 8000;

/**
 * How stale this device's server-side registration may get before a foreground
 * re-syncs it.
 *
 * Half an hour is a compromise between two costs. Too eager and every tab
 * switch is a write. Too lazy and a token FCM has quietly rotated stays broken
 * for the rest of the session — and a broken token is invisible: the switch
 * still reads "on", the browser still reports permission granted, and the only
 * symptom is notifications that never arrive.
 */
const RESYNC_AFTER_MS = 30 * 60 * 1000;

/**
 * Module state, because these facts are per *device*, not per component
 * instance — and this hook is mounted more than once at a time (the prompt in
 * the shell, the switch in settings). Kept as refs they would duplicate: two
 * foreground subscriptions means every message toasts twice, and two sync
 * effects means two identical writes on every load.
 */
let foregroundOwner: symbol | null = null;
let syncedAccountId: string | null = null;
let lastSyncAt = 0;
let syncInFlight: Promise<void> | null = null;

export type PushState =
  /**
   * Nothing is known yet. Resolving the real state needs an await (`isSupported`
   * probes for a push manager and IndexedDB), so this cannot start at `off`:
   * every consumer would render "Turn on notifications" for a frame or two and
   * then yank it away on a browser that never supported push in the first place.
   */
  | 'checking'
  | 'unsupported'
  /** iOS in a browser tab: real push, but only once the app is installed. */
  | 'needs-install'
  | 'unconfigured'
  | 'denied'
  | 'off'
  | 'enabling'
  | 'on';

async function swRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;

  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => {
      setTimeout(resolve, SW_READY_TIMEOUT_MS, undefined);
    }),
  ]);
}

/**
 * Asks FCM for this device's token.
 *
 * The registration has to be passed explicitly. Left to itself the SDK goes
 * looking for `/firebase-messaging-sw.js`, which we deliberately do not ship —
 * and because Hosting rewrites every unmatched path to the SPA shell, that
 * request returns HTML rather than a 404, so registration fails on a MIME error
 * instead of anything that reads like a missing file.
 */
async function issueToken(vapidKey: string): Promise<string | null> {
  if (!(await isSupported().catch(() => false))) return null;

  const registration = await swRegistration();
  if (!registration) {
    throw new Error('The background worker has not started yet. Reload the page and try again.');
  }

  return getToken(getMessaging(firebaseApp()), {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
}

/**
 * Re-mints this device's token and hands it to the server.
 *
 * Registration used to happen exactly once, the moment someone tapped "Turn
 * on", and then never again for the life of the install. Four things rotted
 * quietly because of that, and every one of them presents identically — a
 * device that says notifications are on and receives nothing:
 *
 *  - FCM rotates tokens. The rotated token is a dead row on our side.
 *  - The browser rotates the underlying push subscription, which invalidates the
 *    token even when FCM has not touched it. `pushsubscriptionchange` in the
 *    worker now reports this the moment it happens.
 *  - `sendToAccounts` prunes tokens FCM reports as gone, and nothing ever put
 *    them back. One bad delivery window turned push off permanently.
 *  - The token document is keyed by the token and stamped with an accountId, so
 *    on a shared browser it kept belonging to whoever first enabled it.
 *
 * Cheap enough to run on load, on every foreground after `RESYNC_AFTER_MS`, and
 * immediately on a subscription change: one `getToken` (which no-ops into cache
 * when nothing has moved) and one small write.
 */
async function syncToken(vapidKey: string, accountId: string, force: boolean): Promise<void> {
  if (!force && syncedAccountId === accountId && Date.now() - lastSyncAt < RESYNC_AFTER_MS) return;
  // Coalesced: a visibility change landing on top of an in-flight sync would
  // otherwise mint the same token twice and race two writes at the same doc.
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      if (force) {
        // The old registration is known-bad, and `getToken` will happily hand
        // back its cached copy. Dropping it first is what makes this a refresh
        // rather than a no-op.
        await deleteToken(getMessaging(firebaseApp())).catch(() => undefined);
      }

      const token = await issueToken(vapidKey);
      if (!token) return;

      await pushApi.register({
        token,
        platform: 'web',
        userAgent: navigator.userAgent.slice(0, 400),
      });

      localStorage.setItem(STORAGE_KEY, token);
      localStorage.removeItem(DISABLED_STORAGE_KEY);
      syncedAccountId = accountId;
      lastSyncAt = Date.now();
    } catch {
      // Silent by design. This is background upkeep nobody asked for; the
      // explicit toggle reports its own failures loudly. Release the claim so
      // the next foreground retries rather than assuming it is done.
      syncedAccountId = null;
      lastSyncAt = 0;
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

/**
 * FR-601 — web push, over Firebase Cloud Messaging.
 *
 * Three things have to line up before a browser will deliver a push: a service
 * worker, a granted Notification permission, and a VAPID key. Any of them
 * missing means the switch must not be offered — a toggle that silently fails
 * is worse than no toggle, which is the same rule the uploaders follow.
 *
 * Permission is only ever requested from a user gesture. A permission prompt on
 * page load is the fastest way to get denied permanently, and `denied` cannot be
 * recovered from in-app: the user has to change it in browser settings.
 */
export function usePushNotifications(): {
  state: PushState;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  sendTest: () => Promise<void>;
} {
  const [state, setState] = useState<PushState>('checking');
  const { account } = useSession();
  const accountId = account?.id ?? null;

  const {
    data: capabilities,
    isPending: capabilitiesPending,
    isError: capabilitiesFailed,
  } = useQuery({
    queryKey: ['notifications', 'push', 'status'],
    queryFn: pushApi.status,
    staleTime: Infinity,
    retry: false,
    enabled: Boolean(accountId),
  });

  const vapidKey = capabilities?.vapidKey ?? null;

  // Resolve the starting state once the environment is known.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!isFirebaseConfigured || typeof window === 'undefined') {
        if (!cancelled) setState('unsupported');
        return;
      }

      // Hold until the server has said whether push is configured at all.
      // Offering the switch before that answer lands lets someone tap it, sit
      // through the browser's permission dialog, and only then be told this
      // environment has no push key — having spent the one prompt they get.
      if (capabilitiesPending) {
        if (!cancelled) setState('checking');
        return;
      }

      /**
       * iOS is checked before capability, not after.
       *
       * Safari grants web push only to a PWA that has been added to the Home
       * Screen; in a tab `window.Notification` is not even defined. Falling
       * through to the generic check would report `unsupported` and render
       * nothing, telling an iPhone user that notifications are impossible when
       * the actual answer is one Share-sheet tap away. This is why iPhone users
       * in particular saw notifications only while the app was open.
       */
      if (isIosDevice() && !isStandalone()) {
        if (!cancelled) setState('needs-install');
        return;
      }

      // Safari below 16.4 and every browser in a non-secure context land here.
      if (!('Notification' in window) || !(await isSupported().catch(() => false))) {
        if (!cancelled) setState('unsupported');
        return;
      }
      // A failed status call is treated exactly like a missing key. We cannot
      // confirm push works, and a switch that might not is worse than none.
      if (capabilitiesFailed || !capabilities?.available) {
        if (!cancelled) setState('unconfigured');
        return;
      }
      if (cancelled) return;

      if (Notification.permission === 'denied') {
        localStorage.removeItem(DISABLED_STORAGE_KEY);
        setState('denied');
      } else if (
        Notification.permission === 'granted' &&
        !localStorage.getItem(DISABLED_STORAGE_KEY)
      ) {
        // Permission is the durable browser-level setting. The cached token is
        // just bookkeeping: it can disappear when site data is cleared, and FCM
        // can rotate or prune registrations. Treat granted permission as on,
        // then let the sync effect below mint/register the current token again.
        setState('on');
      } else setState('off');
    })();

    return () => {
      cancelled = true;
    };
  }, [capabilities, capabilitiesPending, capabilitiesFailed]);

  /**
   * Keeps the server's copy of this device's token current.
   *
   * Three triggers, because a token can go bad at three different moments: on
   * load and account change (the old behaviour), whenever the app returns to
   * the foreground after a gap, and the instant the worker reports the browser
   * rotating the subscription out from under us. See `syncToken`.
   */
  useEffect(() => {
    if (state !== 'on' || !accountId || !vapidKey) return;

    void syncToken(vapidKey, accountId, false);

    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      void syncToken(vapidKey, accountId, false);
    };

    // `pushsubscriptionchange` is the one case worth forcing a fresh token for:
    // the existing one is known dead, so honouring the interval would leave the
    // device silent for up to half an hour for no reason.
    const offMessage = onSwMessage((message) => {
      if (message.type === 'pushsubscriptionchange') void syncToken(vapidKey, accountId, true);
    });

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);

    return () => {
      offMessage();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [state, accountId, vapidKey]);

  /**
   * Foreground notifications.
   *
   * The worker shows a system notification for every push, including while a
   * tab is focused — a push handler that shows nothing is a spec violation that
   * gets the subscription revoked. The toast is the in-app echo of that, so the
   * event is visible to someone already reading the page rather than only in the
   * OS tray behind the window.
   *
   * This used to be wired to `onMessage` from `firebase/messaging`, which never
   * fired once: that API is a bridge from FCM's own `firebase-messaging-sw.js`,
   * and we ship our own worker instead. Ours posts the message directly.
   */
  const listenerId = useRef<symbol | null>(null);
  listenerId.current ??= Symbol('push-foreground');

  useEffect(() => {
    if (state !== 'on' || !isFirebaseConfigured) return;

    // First mount to get here owns the subscription; any other instance sits
    // this one out rather than adding a second toast for the same message.
    const id = listenerId.current;
    if (foregroundOwner && foregroundOwner !== id) return;
    foregroundOwner = id;

    const off = onSwMessage((message) => {
      if (message.type !== 'push') return;
      if (document.visibilityState !== 'visible') return;
      toast.success(message.payload.title, message.payload.body);
    });

    return () => {
      off();
      if (foregroundOwner === id) foregroundOwner = null;
    };
  }, [state]);

  const enable = useCallback(async (): Promise<void> => {
    if (state === 'needs-install') {
      toast.info(
        'Install InternLink first',
        'On iPhone and iPad, notifications only work once the app is on your Home Screen.',
      );
      return;
    }
    if (!vapidKey) {
      toast.error('Notifications are not available', 'This environment has no push key set up.');
      return;
    }

    setState('enabling');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      const token = await issueToken(vapidKey);
      if (!token) {
        setState('off');
        toast.error('Could not turn on notifications', 'Your browser did not issue a token.');
        return;
      }

      await pushApi.register({
        token,
        platform: 'web',
        userAgent: navigator.userAgent.slice(0, 400),
      });

      localStorage.setItem(STORAGE_KEY, token);
      localStorage.removeItem(DISABLED_STORAGE_KEY);
      syncedAccountId = accountId;
      lastSyncAt = Date.now();
      setState('on');
      toast.success('Notifications are on', 'We will let you know when a message arrives.');
    } catch (error) {
      setState('off');
      toast.error(
        'Could not turn on notifications',
        error instanceof Error ? error.message : 'Try again in a moment.',
      );
    }
  }, [state, vapidKey, accountId]);

  const disable = useCallback(async (): Promise<void> => {
    const token = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(DISABLED_STORAGE_KEY, 'true');
    syncedAccountId = null;
    lastSyncAt = 0;
    setState('off');

    // Deleting the FCM token first means the browser stops receiving even if
    // the API call fails — the user asked for silence, so silence is what they
    // get regardless of whether our bookkeeping succeeds.
    if (await isSupported().catch(() => false)) {
      await deleteToken(getMessaging(firebaseApp())).catch(() => undefined);
    }
    if (token) await pushApi.unregister(token).catch(() => undefined);
  }, []);

  const sendTest = useCallback(async (): Promise<void> => {
    const result = await pushApi.test().catch(() => null);
    if (!result || result.sent === 0) {
      toast.error('No notification sent', 'This device may not be registered any more.');
      return;
    }
    toast.success('Test sent', `Delivered to ${result.sent} device${result.sent === 1 ? '' : 's'}.`);
  }, []);

  return { state, enable, disable, sendTest };
}
