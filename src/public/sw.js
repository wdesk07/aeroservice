const CACHE_NAME = "aero-app-offline-v2";
const OFFLINE_URL = "/offline.html";
const KIOSK_URL = "/presence/borne";
const NEVER_CACHE = ["/api/", "/auth/", "/rest/", "/functions/"];
const isStaticAsset = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname === "/manifest.webmanifest" ||
  url.pathname === "/aero-service-logo.svg" ||
  /\.(?:css|js|woff2?|png|jpe?g|svg|webp|ico)$/.test(url.pathname);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const path of [OFFLINE_URL, KIOSK_URL, "/"]) {
      try {
        const response = await fetch(path, { cache: "reload" });
        if (response.ok) await cache.put(path, response);
      } catch {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("aero-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        // Cache only public shells. Authenticated records and API responses are never cached here.
        if (response.ok && ["/", KIOSK_URL, OFFLINE_URL].includes(url.pathname)) {
          await cache.put(url.pathname, response.clone());
        }
        return response;
      } catch {
        const exact = await cache.match(url.pathname);
        if (exact) return exact;
        return (await cache.match(OFFLINE_URL)) || new Response(
          "<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Aéro Service hors connexion</title><body style=\"font:16px Arial;padding:24px;color:#15243a\"><h1>Aéro Service — hors connexion</h1><p>Internet est indisponible. Les données serveur ne sont pas actualisées. Les opérations officielles nécessitant le serveur sont suspendues. Utilisez la procédure de secours validée par la Direction.</p><p><a href=\"/presence/borne\">Essayer la borne de présence</a></p></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
        );
      }
    })());
    return;
  }

  if (isStaticAsset(url)) {
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
