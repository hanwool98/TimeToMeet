// Minimal service worker whose only purpose is to satisfy the browser's PWA
// "installable" requirement (Chrome/Samsung Internet require a registered SW
// with a fetch handler before they offer "설치" instead of just a bookmark
// shortcut). Deliberately does no caching - this app deploys frequently, and
// caching responses here risks serving stale JS/CSS after a release, which
// would be a worse regression than the missing install prompt it fixes.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
