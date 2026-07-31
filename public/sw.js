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
