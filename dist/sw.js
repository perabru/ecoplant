/* Public app shell and pinned SDKs only. User records stay in the UID-scoped DB. */
const VERSION = 'v13-ecoplant-framing';
const PREFIX = 'ecoplant-';
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const SDK_CACHE = `${PREFIX}sdk-${VERSION}`;
// plant-ai.js alone writes and validates this public model cache. Keep it when
// updating the app so the next analysis does not download the model again.
const VERIFIED_AI_CACHE = 'ecoplant-ai-verified-v1';
const BASE = new URL('./', self.location.href);
const SHELL_FILES = [
  './', './index.html', './styles.css', './app.js', './firebase.js',
  './local-db.js', './pwa.js', './triage.js', './model-config.js', './classifier.js', './plant-ai.js', './plant-health.js', './image-framing.js', './report.js', './theme.js', './theme.css', './experience.js', './experience.css', './manifest.webmanifest',
  './assets/ecoplant-icon-192.png', './assets/ecoplant-icon-512.png', './assets/ecoplant-maskable-512.png',
  './assets/ecoplant-apple-touch-180.png', './assets/favicon-32.png', './assets/favicon-64.png', './assets/favicon.ico', './assets/ecoplant-logo.png', './assets/garden.svg'
];
const STATIC_URLS = new Set(SHELL_FILES.map(file => new URL(file, BASE).href));
const SDK_FILES = ['app', 'auth', 'database'].map(name => `https://www.gstatic.com/firebasejs/13.2.0/firebase-${name}.js`);
const PINNED_IMAGE_SDKS = new Set([
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js'
]);

function safeResponse(response) {
  return response && response.status === 200 && !response.redirected;
}
async function optionalCache(name) {
  try { return await caches.open(name); } catch { return null; }
}
async function cachedResponse(cache, url) {
  if (!cache || !url) return null;
  try { return await cache.match(url); } catch { return null; }
}
async function saveResponse(cache, url, response) {
  if (!cache) return;
  try { await cache.put(url, response); } catch { /* Quota/disabled storage must not hide a network success. */ }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await optionalCache(SHELL_CACHE);
    await Promise.allSettled(SHELL_FILES.map(async file => {
      const url = new URL(file, BASE);
      const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
      if (safeResponse(response)) await saveResponse(cache, url.href, response);
    }));
    const sdkCache = await optionalCache(SDK_CACHE);
    await Promise.allSettled(SDK_FILES.map(async url => {
      const response = await fetch(url, { credentials: 'omit', cache: 'reload' });
      if (safeResponse(response) && response.type !== 'opaque') await saveResponse(sdkCache, url, response);
    }));
    if (!self.registration.active) await self.skipWaiting();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.postMessage({ type: 'UPDATE_READY' }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.allSettled(keys.filter(key => key.startsWith(PREFIX) && ![SHELL_CACHE, SDK_CACHE, VERIFIED_AI_CACHE].includes(key)).map(key => caches.delete(key)));
    } catch { /* The app remains usable when persistent storage is unavailable. */ }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, fallbackURL) {
  const cache = await optionalCache(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.status >= 500) {
      const cached = await cachedResponse(cache, request.url) || await cachedResponse(cache, fallbackURL);
      if (cached) return cached;
    }
    if (safeResponse(response)) await saveResponse(cache, request.url, response.clone());
    return response;
  } catch (error) {
    const cached = await cachedResponse(cache, request.url) || await cachedResponse(cache, fallbackURL);
    if (cached) return cached;
    return new Response('Sem conexão. Abra o aplicativo uma vez com internet para preparar o acesso offline.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function sdkCacheFirst(request) {
  const cache = await optionalCache(SDK_CACHE);
  const cached = await cachedResponse(cache, request.url);
  if (cached) return cached;
  const response = await fetch(request);
  if (safeResponse(response) && response.type !== 'opaque') await saveResponse(cache, request.url, response.clone());
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
    return;
  }
  // Demand-cache only the pinned public image runtimes. Do not intercept model
  // URLs here: plant-ai.js must verify each binary before saving or using it.
  if (url.origin === 'https://cdn.jsdelivr.net' && !url.search && (
    PINNED_IMAGE_SDKS.has(url.href) ||
    /^\/npm\/onnxruntime-web@1\.30\.0\/dist\/[a-zA-Z0-9._-]+\.(?:js|mjs|wasm)$/.test(url.pathname)
  )) {
    event.respondWith(sdkCacheFirst(request));
  }
});
