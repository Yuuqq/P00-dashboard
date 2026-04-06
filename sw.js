/**
 * 🔌 P00 学习中枢 Service Worker
 *
 * 策略：
 * 1. 安装时预缓存当前项目的核心文件
 * 2. 核心壳资源走网络优先，在线时尽快拿到最新版本
 * 3. 其余同源静态资源走缓存优先，并在后台刷新
 * 4. 离线时回退到缓存的 index.html
 */
const CACHE_PREFIX = "journalism-tool-p00-";
const CACHE_NAME = CACHE_PREFIX + "v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./pm-metrics.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-32.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./shared/design-tokens.css",
  "./shared/dark-toggle.js",
  "./shared/toast.js"
];

function isCoreShellRequest(request, url) {
  if (request.destination === "document" || request.destination === "script" || request.destination === "style") {
    return true;
  }
  return url.pathname.endsWith("/manifest.json");
}

function fallbackDocumentResponse(cache) {
  return cache.match("./index.html").then((cached) => cached || Response.error());
}

function offlineErrorResponse(request, cache) {
  if (request.destination === "document") {
    return fallbackDocumentResponse(cache);
  }
  return Promise.resolve(Response.error());
}

// Install: Pre-cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch(() => {
        // Silently skip missing optional files
        return Promise.allSettled(
          CORE_ASSETS.map((url) => cache.add(url).catch(() => {}))
        );
      });
    })
  );
  self.skipWaiting();
});

// Activate: Clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: Network-first for the app shell, cache-first for other same-origin assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin API calls
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      if (isCoreShellRequest(event.request, url)) {
        return fetch(event.request).then((response) => {
          if (response && response.ok) {
            if (response.status === 200) {
              const clone = response.clone();
              cache.put(event.request, clone);
            }
            return response;
          }
          return cache.match(event.request).then((cached) => {
            if (cached) return cached;
            if (event.request.destination === "document") {
              return cache.match("./index.html");
            }
            return response;
          });
        }).catch(() => {
          return cache.match(event.request).then((cached) => {
            if (cached) return cached;
            return offlineErrorResponse(event.request, cache);
          });
        });
      }
      return cache.match(event.request).then((cached) => {
        if (cached) {
          // Return cache, but also update in background (stale-while-revalidate)
          fetch(event.request).then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              cache.put(event.request, clone);
            }
            return response;
          }).catch(() => {});
          return cached;
        }
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            cache.put(event.request, clone);
          }
          return response;
        }).catch(() => {
          return offlineErrorResponse(event.request, cache);
        });
      });
    })
  );
});
