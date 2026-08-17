/* eslint-disable no-undef */
/**
 * LEGACY. Nothing in the current build imports this file — push handling now
 * lives in src/sw.js, which the browser evaluates directly.
 *
 * It stays deployed for the workers already installed on people's devices. Those
 * were generated with `importScripts('/push-sw.js')` baked in, and they keep
 * re-running it on every restart until they pick up the new worker. Deleting the
 * file would not 404 — Hosting rewrites unmatched paths to the SPA shell, so
 * they would import HTML and fail to start at all, taking the update check down
 * with them. Serving the old handler for one more cycle costs 2KB and means
 * those devices keep receiving notifications right up to the moment they
 * upgrade.
 *
 * Safe to delete once the old workers have aged out.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    const parsed = event.data.json();
    // FCM nests data-only messages under `data`; a raw Web Push send does not.
    payload = parsed.data ?? parsed ?? {};
  } catch {
    payload = { title: 'InternLink', body: event.data.text() };
  }

  const title = payload.title || 'InternLink';
  const path = payload.path || '/notifications';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-64.png',
      image: payload.imageUrl || undefined,
      // Same tag replaces rather than stacks, so a device coming back online
      // after a gap shows one notification per subject, not twelve.
      tag: payload.tag || undefined,
      renotify: Boolean(payload.tag),
      data: { path },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.path || '/notifications';
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Focus an open tab and route it, rather than opening a second copy of
      // the app beside the one already running.
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target).catch(() => undefined);
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});
