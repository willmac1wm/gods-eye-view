/*
 * Cape May Dispatch push alerts: shows a member's watched-place alert and
 * opens the map at the incident when it is tapped. It does nothing else: no
 * caching, no fetch handling, so the site always loads fresh.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = String(data.title || 'Cape May Dispatch').slice(0, 120);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: String(data.body || '').slice(0, 300),
      tag: String(data.tag || 'cape-may-dispatch'),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: {
        url:
          typeof data.url === 'string' && data.url.startsWith('/')
            ? data.url
            : '/',
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin)
    .href;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (
            new URL(client.url).origin === self.location.origin &&
            'navigate' in client
          )
            return client.navigate(url).then((c) => (c || client).focus());
        }
        return self.clients.openWindow(url);
      }),
  );
});
