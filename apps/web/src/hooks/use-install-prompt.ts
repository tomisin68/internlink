import { useCallback, useEffect, useState } from 'react';
import { isIosSafari, isStandalone } from '@/lib/pwa';

export type InstallState =
  /** Already running as an installed app. There is nothing left to offer. */
  | 'installed'
  /** Chromium handed us a deferred prompt — we can open the real dialog. */
  | 'available'
  /** iOS Safari: installable, but only by hand through the Share sheet. */
  | 'manual-ios'
  /** Not installable here — an unsupported browser, or criteria unmet. */
  | 'unavailable';

/**
 * Installing the app.
 *
 * Nothing in the app had ever listened for `beforeinstallprompt`, so the
 * install prompt could not appear no matter how correct the manifest was. The
 * manifest, icons and service worker were all in place; the missing piece was
 * the one line of JavaScript that catches the event and the UI that spends it.
 *
 * Two paths, because the platforms genuinely differ:
 *
 *  - Chromium fires `beforeinstallprompt`, which we defer (see index.html) and
 *    replay from a real user gesture. The event may be spent exactly once.
 *  - Safari on iOS fires nothing and exposes no API. The only way in is Share →
 *    Add to Home Screen, so the honest answer there is instructions, not a
 *    button that cannot work. This matters more on iOS than anywhere else:
 *    installing is also the *only* way to get push notifications there.
 */
export function useInstallPrompt(): {
  state: InstallState;
  /** Opens the browser's install dialog. Chromium only — see `state`. */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
} {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    () => (typeof window === 'undefined' ? null : (window.__internlinkInstallPrompt ?? null)),
  );
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    // Both listeners, not one: `internlink:installable` covers the event the
    // inline capture already swallowed, and `beforeinstallprompt` covers the
    // case where that script did not run (an old cached index.html, a browser
    // extension, a test harness rendering the tree on its own).
    function adopt(): void {
      setDeferred(window.__internlinkInstallPrompt ?? null);
    }

    function capture(event: BeforeInstallPromptEvent): void {
      event.preventDefault();
      window.__internlinkInstallPrompt = event;
      setDeferred(event);
    }

    function onInstalled(): void {
      window.__internlinkInstallPrompt = undefined;
      setDeferred(null);
      setInstalled(true);
    }

    window.addEventListener('internlink:installable', adopt);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('internlink:installable', adopt);
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';

    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      return outcome;
    } catch {
      // Chromium rejects a second `prompt()` on the same event.
      return 'unavailable';
    } finally {
      // Spent either way: the event cannot be reused, and keeping it around
      // would leave a button that silently does nothing.
      window.__internlinkInstallPrompt = undefined;
      setDeferred(null);
    }
  }, [deferred]);

  const state: InstallState = installed
    ? 'installed'
    : deferred
      ? 'available'
      : isIosSafari()
        ? 'manual-ios'
        : 'unavailable';

  return { state, install };
}
