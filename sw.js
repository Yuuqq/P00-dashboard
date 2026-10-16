/**
 * P00 Service Worker
 *
 * HTML navigations are network-first so a deploy is not stuck behind a stale shell.
 * Stylesheets are network-first too, so a theme deploy is not stuck in cache.
 * Other same-origin GETs stay cache-first with a background refresh.
 * Precache misses are logged; install still finishes so one missing file does not
 * disable the offline dashboard shell.
 */
const CACHE_NAME = "journalism-tool-P00-v3";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icon-32.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./styles.css",
  "./modern-styles.css",
  "./app.js",
  "./pm-metrics.js",
  "./shared/design-tokens.css",
  "./shared/toast.js",
  "./shared/dark-toggle.js"
];

function isDocumentRequest(request) {
  const url = new URL(request.url);
  return request.mode === "navigate" || request.destination === "document" || url.pathname.endsWith(".html");
}

function isStyleRequest(request) {
  const url = new URL(request.url);
  return request.destination === "style" || url.pathname.endsWith(".css");
}

async function putIfOk(request, response) {
  if (!response || response.status !== 200) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const results = await Promise.allSettled(CORE_ASSETS.map(async (url) => {
        try {
          await cache.add(url);
        } catch (error) {
          console.warn("[P00-dashboard] Precache miss:", url, error);
          throw error;
        }
      }));
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) {
        console.warn(`[P00-dashboard] Precache incomplete: ${failed}/${CORE_ASSETS.length} assets failed.`);
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

async function networkFirstDocument(request) {
  try {
    const response = await fetch(request);
    await putIfOk(request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(request) || await caches.match("./index.html");
    if (cached) return cached;
    throw error;
  }
}

async function networkFirstStyle(request) {
  try {
    const response = await fetch(request);
    await putIfOk(request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putIfOk(request, response);
  return response;
}

async function refreshCachedAsset(request) {
  const cached = await caches.match(request);
  if (!cached) return;
  try {
    const response = await fetch(request);
    await putIfOk(request, response);
  } catch (error) {
    console.warn("[P00-dashboard] Background refresh failed:", request.url, error);
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  if (isDocumentRequest(event.request)) {
    event.respondWith(networkFirstDocument(event.request));
    return;
  }

  if (isStyleRequest(event.request)) {
    event.respondWith(networkFirstStyle(event.request));
    return;
  }

  event.respondWith(cacheFirstAsset(event.request));
  event.waitUntil(refreshCachedAsset(event.request));
});
