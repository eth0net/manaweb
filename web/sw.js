// The app shell offline. The catalog is not here: it is megabytes on another
// origin and IndexedDB already holds it — see `docs/architecture.md`.

const VERSION = "__VERSION__";
const SHELL = __SHELL__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

// Everything the last generation cached is named after it, so a deploy takes
// its whole cache rather than entries one at a time.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== VERSION)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Every route is the one document, so a reload deep in the app works
  // offline the same as the root does.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
    return;
  }

  // The hashed files never change under their name; anything else is asked
  // for first and only falls back.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((held) => held ?? fetch(request)),
    );
    return;
  }

  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
