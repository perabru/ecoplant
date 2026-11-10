/* App shell only. Firebase user records remain in the UID-scoped IndexedDB store. */
const VERSION = 'v8-ecoplant-model-photo-upload';
const PREFIX = 'ecoplant-';
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const SDK_CACHE = `${PREFIX}sdk-${VERSION}`;
const BASE = new URL('./', self.location.href);
const SHELL_FILES = [
  './', './index.html', './styles.css', './app.js', './firebase.js',
  './local-db.js', './pwa.js', './triage.js', './classifier.js', './report.js', './theme.js', './theme.css', './experience.js', './experience.css', './manifest.webmanifest',
  './assets/ecoplant-icon-192.png', './assets/ecoplant-icon-512.png', './assets/ecoplant-maskable-512.png',
  './assets/ecoplant-apple-touch-180.png', './assets/favicon-32.png', './assets/favicon-64.png', './assets/favicon.ico', './assets/ecoplant-logo.png', './assets/garden.svg'
];
const STATIC_URLS = new Set(SHELL_FILES.map(file => new URL(file, BASE).href));
const SDK_FILES = ['app', 'auth', 'database'].map(name => `https://www.gstatic.com/firebasejs/13.2.0/firebase-${name}.js`);

function safeResponse(response) {
  return response && response.status === 200 && !response.redirected;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(SHELL_FILES.map(async file => {
      const url = new URL(file, BASE);
      const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
      if (safeResponse(response)) await cache.put(url.href, response);
    }));
    const sdkCache = await caches.open(SDK_CACHE);
    await Promise.allSettled(SDK_FILES.map(async url => {
      const response = await fetch(url, { credentials: 'omit', cache: 'reload' });
      if (safeResponse(response) && response.type !== 'opaque') await sdkCache.put(url, response);
    }));
    if (!self.registration.active) await self.skipWaiting();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.postMessage({ type: 'UPDATE_READY' }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && ![SHELL_CACHE, SDK_CACHE].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, fallbackURL) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (safeResponse(response)) await cache.put(request.url, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request.url) || (fallbackURL && await cache.match(fallbackURL));
    if (cached) return cached;
    return new Response('Sem conexão. Abra o aplicativo uma vez com internet para preparar o acesso offline.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function sdkCacheFirst(request) {
  const cache = await caches.open(SDK_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  if (safeResponse(response) && response.type !== 'opaque') await cache.put(request.url, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never intercept OAuth helpers, authentication, Realtime Database or other APIs.
  if (url.pathname.includes('/__/auth/') || url.pathname.includes('/__/firebase/') || url.pathname.startsWith('/api/')) return;
  if (url.origin === BASE.origin) {
    const canonical = new URL(url.pathname, url.origin).href;
    if (!STATIC_URLS.has(canonical)) return;
    event.respondWith(networkFirst(request, request.mode === 'navigate' ? new URL('./index.html', BASE).href : null));
    return;
  }
  // Public immutable SDK source code only; no credentials or API responses are cached.
  if (url.origin === 'https://www.gstatic.com' && /^\/firebasejs\/13\.2\.0\/[a-zA-Z0-9/_-]+\.js$/.test(url.pathname)) {
    event.respondWith(sdkCacheFirst(request));
  }
});
