/**
 * The page's half of the conversation with the service worker.
 *
 * Two things made this necessary. The first is that `onMessage` from
 * `firebase/messaging` never fired: that API is a bridge from FCM's own
 * `firebase-messaging-sw.js`, which we deliberately do not ship — one worker per
 * scope, and ours has to be the one. So the foreground-notification path was
 * dead code that looked correct. Our worker posts the message itself now.
 *
 * The second is notification taps. The worker hands over a path instead of
 * calling `client.navigate()`, which is a full document reload and is not
 * implemented on iOS at all — a tap would focus the app and leave it on whatever
 * screen it was already showing.
 *
 * One listener, fanned out to subscribers, because `navigator.serviceWorker` is
 * a single global and several hooks care about different messages from it.
 */

export type SwMessage =
  /** A push arrived and the worker has displayed it. */
  | { type: 'push'; payload: { title: string; body: string; path: string; tag: string | null } }
  /** A notification was tapped; route here without reloading. */
  | { type: 'navigate'; path: string }
  /** The browser rotated this device's subscription — the token must be re-minted. */
  | { type: 'pushsubscriptionchange' };

type Handler = (message: SwMessage) => void;

const handlers = new Set<Handler>();
let attached = false;

function isSwMessage(value: unknown): value is SwMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'push' || type === 'navigate' || type === 'pushsubscriptionchange';
}

function attach(): void {
  if (attached || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  attached = true;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!isSwMessage(event.data)) return;
    // Snapshotted: a handler that unsubscribes itself while we are iterating
    // would otherwise mutate the set mid-loop.
    for (const handler of [...handlers]) {
      try {
        handler(event.data);
      } catch {
        // One bad subscriber must not swallow the message for the others.
      }
    }
  });
}

/** Subscribes to worker messages. Returns the unsubscribe. */
export function onSwMessage(handler: Handler): () => void {
  attach();
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/**
 * Clears the Home Screen badge.
 *
 * Called when the app comes to the foreground: the badge exists to say "there is
 * something you have not seen", and opening the app is the user acting on it. A
 * badge that outlives the visit is the kind of thing people uninstall an app
 * over.
 */
export async function clearAppBadge(): Promise<void> {
  try {
    if (typeof navigator === 'undefined') return;
    const clear = (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge;
    if (typeof clear === 'function') await clear.call(navigator);
  } catch {
    // Unsupported on most desktop browsers. Nothing to report.
  }
}
