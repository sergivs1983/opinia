self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function normalizePayload(raw) {
  const fallback = {
    title: 'OpinIA',
    body: 'Tens un recordatori pendent al planner.',
    url: '/dashboard/planner',
  };

  if (!raw || typeof raw !== 'object') return fallback;

  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : fallback.title;
  const body = typeof raw.body === 'string' && raw.body.trim() ? raw.body.trim() : fallback.body;
  const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : fallback.url;

  return {
    title,
    body,
    url,
    schedule_id: typeof raw.schedule_id === 'string' ? raw.schedule_id : undefined,
    biz_id: typeof raw.biz_id === 'string' ? raw.biz_id : undefined,
    platform: typeof raw.platform === 'string' ? raw.platform : undefined,
  };
}

self.addEventListener('push', (event) => {
  let payload = normalizePayload(null);

  if (event.data) {
    try {
      payload = normalizePayload(event.data.json());
    } catch {
      try {
        payload = normalizePayload(JSON.parse(event.data.text()));
      } catch {
        payload = normalizePayload(null);
      }
    }
  }

  const notificationOptions = {
    body: payload.body,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: {
      url: payload.url,
      schedule_id: payload.schedule_id,
      biz_id: payload.biz_id,
      platform: payload.platform,
    },
    tag: payload.schedule_id ? `opinia-schedule-${payload.schedule_id}` : 'opinia-reminder',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(payload.title, notificationOptions));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = (event.notification && event.notification.data && event.notification.data.url) || '/dashboard/planner';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          try {
            const clientUrl = new URL(client.url);
            if (clientUrl.pathname.startsWith('/dashboard') && typeof client.focus === 'function') {
              if (typeof client.navigate === 'function') {
                client.navigate(targetPath);
              }
              return client.focus();
            }
          } catch {
            // ignore malformed client url
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetPath);
      }
      return undefined;
    }),
  );
});
