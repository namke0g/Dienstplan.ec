// Service worker for browser push notifications. Only shows what the server sends (a generic text) and opens the app on click.
self.addEventListener("push", (event) => {
  let d = { title: "Dienstplan", body: "Es gibt eine neue Mitteilung.", url: "/benachrichtigungen", urgent: false };
  try { if (event.data) d = { ...d, ...event.data.json() }; } catch (e) { /* keep the defaults */ }
  event.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: "/icon.svg", badge: "/icon.svg", tag: "dienstplan", renotify: true,
    requireInteraction: !!d.urgent, data: { url: typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) { await open.focus(); return open.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
