self.addEventListener("push", (event) => {
  let d = { title: "Dienstplan", body: "Neue Mitteilung", url: "/benachrichtigungen", urgent: false };
  try { d = { ...d, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: "/icon.svg", badge: "/icon.svg", data: { url: d.url }, requireInteraction: !!d.urgent, tag: "dienstplan",
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || "/"));
});
