/* eslint-disable no-undef */
/**
 * Push handling, imported into the generated Workbox service worker.
 *
 * A browser allows one service worker per scope, so this cannot be a separate
 * `firebase-messaging-sw.js` — that would be a second registration at the same
 * scope and whichever landed last would win, silently breaking either offline
 * support or push depending on the order. `workbox.importScripts` in
 * vite.config.ts pulls this into the one worker we already have.
 *
 * The server sends `data`-only messages (see push.service.ts). With a
 * `notification` payload the browser renders its own toast *and* fires this
 * handler, so the user gets two. Owning the display here keeps it to one and
 * lets us set the icon, the tag and where a tap lands.
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
