const CACHE_NAME = "aero-app-offline-v3";
const OFFLINE_URL = "/offline.html";
const KIOSK_URL = "/presence/borne";
const SHELL_URLS = [OFFLINE_URL, KIOSK_URL, "/"];
const NEVER_CACHE = ["/api/", "/auth/", "/rest/", "/functions/"];

const isStaticAsset = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname === "/manifest.webmanifest" ||
  url.pathname === "/aero-service-logo.svg" ||
  /\.(?:css|js|woff2?|png|jpe?g|svg|webp|ico)$/.test(url.pathname);

async function cacheShell(cache, path) {
  try {
    const response = await fetch(path, { cache: "reload", credentials: "same-origin" });
    if (!response.ok) return;
    const clone = response.clone();
    await cache.put(path, clone);

    // Cache the same-origin Next.js chunks referenced by the public shell HTML so
    // the offline screen can render after a first successful online visit.
    if (path === OFFLINE_URL || response.headers.get("content-type")?.includes("text/html")) {
      const html = await response.text();
      const assets = new Set();
      const pattern = /(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g;
      let match;
      while ((match = pattern.exec(html)) !== null) {
        try {
          const asset = new URL(match[1], self.location.origin);
          if (asset.origin === self.location.origin && isStaticAsset(asset)) assets.add(asset.href);
        } catch {}
      }
      await Promise.all([...assets].map(async (assetUrl) => {
        try {
          const assetResponse = await fetch(assetUrl, { cache: "reload", credentials: "same-origin" });
          if (assetResponse.ok) await cache.put(assetUrl, assetResponse);
        } catch {}
      }));
    }
  } catch {}
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_URLS.map((path) => cacheShell(cache, path)));
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
        // Only cache the public application shell. Authenticated pages and server data are never cached.
        if (response.ok && SHELL_URLS.includes(url.pathname)) {
          await cache.put(url.pathname, response.clone());
          if (url.pathname !== OFFLINE_URL) {
            const html = await response.clone().text();
            const assets = new Set();
            const pattern = /(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g;
            let match;
            while ((match = pattern.exec(html)) !== null) {
              try {
                const asset = new URL(match[1], self.location.origin);
                if (asset.origin === self.location.origin && isStaticAsset(asset)) assets.add(asset.href);
              } catch {}
            }
            await Promise.all([...assets].map(async (assetUrl) => {
              try {
                const assetResponse = await fetch(assetUrl);
                if (assetResponse.ok) await cache.put(assetUrl, assetResponse);
              } catch {}
            }));
          }
        }
        return response;
      } catch {
        const exact = await cache.match(url.pathname);
        if (exact) return exact;
        return (await cache.match(OFFLINE_URL)) || new Response(
          "<!doctype html><html lang='fr'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Aéro Service hors connexion</title><body style='font:16px Arial;padding:24px;color:#15243a'><h1>Aéro Service — hors connexion</h1><p>Internet est indisponible. Les données serveur ne sont pas actualisées. Les opérations officielles nécessitant le serveur sont suspendues. Utilisez la procédure de secours validée par la Direction.</p><p><a href='/offline.html'>Ouvrir le carnet de secours hors connexion</a></p></body></html>",
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
