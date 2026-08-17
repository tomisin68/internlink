import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast, useToastStore } from '@/lib/stores';

/**
 * How often to ask the browser whether a new build has shipped.
 *
 * The browser only checks for a new worker on navigation, which in an installed
 * PWA can be *never*: people leave the app open on a phone for days and resume
 * it from the app switcher, which is not a navigation. Without this poll the
 * only way to pick up a deploy was to force-quit the app — so a fix could ship
 * and simply not reach the people who use InternLink most.
 *
 * Five minutes is cheap: `sw.js` is a few kilobytes and served `no-store`, so a
 * check with nothing to report is one small conditional request.
 */
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

/** Floor between checks, so resuming the app repeatedly does not spam Hosting. */
const UPDATE_THROTTLE_MS = 30 * 1000;

/**
 * Surfaces service-worker lifecycle events as toasts, and keeps the app looking
 * for new versions while it runs.
 *
 * The plugin is configured with `registerType: 'prompt'`, so a new bundle sits
 * waiting until the user accepts. That is the right call for an app with a
 * multi-step wizard — auto-updating mid-form would discard everything typed.
 * Prompting still requires *noticing* the new bundle, which is what the polling
 * below is for.
 */
export function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, swRegistration) {
      if (swRegistration) setRegistration(swRegistration);
    },
    onRegisterError(error) {
      // Never surfaced to the user — a failed SW registration degrades to a
      // normal web app, which is a perfectly good outcome.
      console.warn('Service worker registration failed', error);
    },
  });

  useEffect(() => {
    if (!registration) return;

    let lastCheck = 0;
    let disposed = false;

    const check = (): void => {
      if (disposed) return;
      // Offline, `update()` rejects and — worse — some browsers treat the
      // failure as a reason to drop the registration. Skip rather than retry.
      if (!navigator.onLine) return;
      if (Date.now() - lastCheck < UPDATE_THROTTLE_MS) return;
      lastCheck = Date.now();
      void registration.update().catch(() => undefined);
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') check();
    };

    // Resuming from the app switcher is the single most common way a PWA user
    // arrives, and it fires nothing else — no load, no navigation.
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    const timer = window.setInterval(check, UPDATE_INTERVAL_MS);

    check();

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, [registration]);

  useEffect(() => {
    if (!needRefresh) return;

    const id = useToastStore.getState().push({
      title: 'A new version is ready',
      description: 'Reload to get the latest. Anything you are part-way through will be kept.',
      variant: 'default',
      duration: 0, // Stays until acted on — this is a decision, not a notice.
      action: {
        label: 'Reload now',
        onClick: () => {
          setNeedRefresh(false);
          void updateServiceWorker(true);
        },
      },
    });

    return () => useToastStore.getState().dismiss(id);
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  useEffect(() => {
    if (!offlineReady) return;
    toast.success('Ready to work offline', 'InternLink will keep working without a connection.');
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);

  return null;
}
