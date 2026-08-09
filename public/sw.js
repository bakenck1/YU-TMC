const VERSION = "yu-inventory-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // PRD requires a network connection, so the worker deliberately does not
  // cache authenticated inventory data or provide an offline response.
  event.respondWith(fetch(event.request));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage({ type: "VERSION", value: VERSION });
  }
});

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event.data);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      renotify: true,
      data: { url: safeAppPath(payload.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    safeAppPath(event.notification.data?.url),
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) => client.url === targetUrl);
        if (existing) return existing.focus();
        const appClient = clients.find((client) => {
          try {
            return new URL(client.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });
        if (appClient?.navigate) {
          return appClient.navigate(targetUrl)
            .then((client) => client?.focus())
            .catch(() => self.clients.openWindow(targetUrl));
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});

function readPushPayload(data) {
  const fallback = {
    title: "YU Inventory",
    body: "У вас новое уведомление.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "yu-inventory-notification",
    url: "/inventory/inspections",
  };
  if (!data) return fallback;
  try {
    const value = data.json();
    if (!value || typeof value !== "object") return fallback;
    return {
      title: safeText(value.title, fallback.title, 100),
      body: safeText(value.body, fallback.body, 240),
      icon: safeAppPath(value.icon, fallback.icon),
      badge: safeAppPath(value.badge, fallback.badge),
      tag: safeText(value.tag, fallback.tag, 120),
      url: safeAppPath(value.url, fallback.url),
    };
  } catch {
    return fallback;
  }
}

function safeText(value, fallback, maxLength) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function safeAppPath(value, fallback = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
