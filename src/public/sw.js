const CACHE_NAME = "aero-kiosk-offline-v1";
const OFFLINE_URL = "/presence/borne";
const NEVER_CACHE = ["/api/", "/auth/", "/rest/", "/functions/"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(OFFLINE_URL, { cache: "reload" });
      if (response.ok) await cache.put(OFFLINE_URL, response);
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("aero-kiosk-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && !url.pathname.startsWith("/api/")) {
          await cache.put(request, response.clone());
          if (url.pathname === OFFLINE_URL) await cache.put(OFFLINE_URL, response.clone());
        }
        return response;
      } catch {
        return (await cache.match(request)) || (await cache.match(OFFLINE_URL)) || new Response(
          "<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Aéro Service hors connexion</title><body style=\"font:16px Arial;padding:24px;color:#15243a\"><h1>Aéro Service — hors connexion</h1><p>La borne n’a pas encore de page mise en cache. Rétablissez Internet et ouvrez une fois la borne officielle, puis réessayez.</p></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
        );
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/aero-service-logo.svg") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return new Response("", { status: 503 });
      }
    })());
  }
});
