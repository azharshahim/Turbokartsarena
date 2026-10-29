// Updated by preview:build when the application shell changes.
const CACHE_VERSION = 'bc7d96e6f30d7895';
const CACHE_PREFIX = `turbo-karts-arena:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png'];
const SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener('install', (event) => {
  // Install atomically; a missing asset must not replace the working offline shell.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  // Let existing races finish on their current worker. The update activates once
  // its old tabs/windows close, without reloading or interrupting a race.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      !url.href.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Fresh HTML online; never store error pages over the known-good shell.
        const response = await fetch(request);
        if (response.ok) return response;
        return (await caches.open(CACHE_NAME)).match('./index.html');
      } catch {
        return (await caches.open(CACHE_NAME)).match('./index.html');
      }
    })());
  } else if (SHELL_URLS.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(request)) || fetch(request);
    })());
  }
  // Unknown assets use the network normally: never return HTML as JS, images,
  // API responses, or third-party resources, and never grow the cache unbounded.
});
