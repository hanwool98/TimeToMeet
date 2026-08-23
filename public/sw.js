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
  // The installable-PWA check only requires a registered fetch handler to
  // exist and call respondWith() for at least navigation requests - it does
  // not require every request to be intercepted. Re-issuing event.request
  // for every request (including Supabase's POST/RPC calls) creates a
  // second, SW-context fetch whose request body isn't always safely
  // re-sendable, which can intermittently fail with a raw network-level
  // rejection even though the same request would have succeeded natively.
  // That surfaced in the app as a generic "내 행사 정보를 불러오지 못했습니다."
  // error with no actual server-side or network problem. Only GET requests
  // are re-issued here; everything else (all POST/PATCH/etc. API calls) is
  // left completely untouched by not calling respondWith() at all.
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});
