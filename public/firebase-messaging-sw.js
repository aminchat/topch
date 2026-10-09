importScripts('https://www.gstatic.com/firebasejs/12.4.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.4.0/firebase-messaging-compat.js');

const configValue = new URL(self.location.href).searchParams.get('firebaseConfig');
if (configValue) {
  try {
    firebase.initializeApp(JSON.parse(configValue));
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const data = payload.data || payload.notification || {};
      const title = data.title || 'به‌روزرسانی رزرو';
      self.registration.showNotification(title, {
        body: data.body || 'وضعیت رزرو تغییر کرده است.',
        tag: data.notificationId || data.bookingId || 'sansyar-booking',
        data: { bookingId: data.bookingId || '', notificationId: data.notificationId || '' },
      });
    });
  } catch (error) {
    console.error('Firebase messaging service worker could not initialize.', error);
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const bookingId = event.notification.data?.bookingId;
    const relativeTarget = bookingId ? `/?booking=${encodeURIComponent(bookingId)}` : '/';
    const target = new URL(relativeTarget, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ('navigate' in client) await client.navigate(target);
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
