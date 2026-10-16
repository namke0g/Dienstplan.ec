// Service worker for browser push notifications. Shows what the server sends (a generic text) and opens the app on click.

// take over immediately, so clicks can steer every open app tab (navigate() only works on tabs this worker controls)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = { id: "", title: "Dienstplan", body: "Es gibt eine neue Mitteilung.", url: "/benachrichtigungen", urgent: false };
  try { if (event.data) d = { ...d, ...event.data.json() }; } catch (e) { /* keep the defaults */ }
  event.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: "/icon.svg", badge: "/icon.svg",
    // one entry per message: a later routine message must not replace an urgent one; a re-sent message replaces itself
    ...(d.id ? { tag: `dienstplan-${d.id}` } : {}),
    requireInteraction: !!d.urgent, data: { url: typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      try {
        await open.focus();
        if (await open.navigate(url)) return; // resolves to null if the page could not be steered
      } catch (e) { /* tab not controlled by this worker: open the page instead */ }
    }
    await self.clients.openWindow(url);
  })());
});
