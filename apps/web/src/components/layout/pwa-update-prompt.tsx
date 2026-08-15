import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast, useToastStore } from '@/lib/stores';

/**
 * Surfaces service-worker lifecycle events as toasts.
 *
 * The plugin is configured with `registerType: 'prompt'`, so a new bundle sits
 * waiting until the user accepts. That is the right call for an app with a
 * multi-step wizard — auto-updating mid-form would discard everything typed.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // Never surfaced to the user — a failed SW registration degrades to a
      // normal web app, which is a perfectly good outcome.
      console.warn('Service worker registration failed', error);
    },
  });

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
