import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAppBadge, onSwMessage } from '@/lib/sw-bridge';

/**
 * Lands a notification tap on the right screen, and clears the Home Screen
 * badge once the app is actually open.
 *
 * The worker deliberately does not call `client.navigate()` — that is a full
 * document reload, and iOS does not implement it, so a tap would focus the app
 * and leave it exactly where it was. It posts the path instead and this routes
 * it, which is both instant and the only thing that works on iPhone.
 *
 * Mounted once, in the app shell, so it is listening before any notification can
 * be tapped rather than only on the screens that happen to care.
 */
export function useServiceWorkerNavigation(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const off = onSwMessage((message) => {
      if (message.type !== 'navigate') return;
      // Same-origin paths only. The worker builds these from our own payloads,
      // but a router is not the place to find out that assumption was wrong.
      if (!message.path.startsWith('/') || message.path.startsWith('//')) return;
      navigate(message.path);
    });

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void clearAppBadge();
    };

    onVisible();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [navigate]);
}
