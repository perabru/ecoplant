import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Request/Cache API fixtures exercise routing, failure recovery and persistence.
// They do not assert that a third-party CDN or a browser is currently online.
const source = fs.readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
const base = 'https://perabru.github.io/ecoplant/';
const shellName = 'ecoplant-shell-v14-ecoplant-model';
const sdkName = 'ecoplant-sdk-v14-ecoplant-model';
const aiName = 'ecoplant-ai-verified-v1';
let passed = 0;

function fixture({ network, failOpen = false, failWrite = false } = {}) {
  const handlers = new Map(), stores = new Map(), deleted = [], requests = [];
  let claimed = 0;
  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }
  const caches = {
    async open(name) {
      if (failOpen) throw new Error('Storage disabled');
      const values = store(name);
      return {
        async match(key) { return values.get(String(key))?.clone(); },
        async put(key, response) {
          if (failWrite) throw new DOMException('Storage full', 'QuotaExceededError');
          values.set(String(key), response.clone());
        }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { deleted.push(name); return stores.delete(name); }
  };
  const self = {
    location: { href: base + 'sw.js' },
    registration: { active: {} },
    clients: { async claim() { claimed++; }, async matchAll() { return []; } },
    async skipWaiting() {},
    addEventListener(type, handler) { handlers.set(type, handler); }
  };
  const context = vm.createContext({ self, caches, URL, Response, Request, Set, Promise, console,
    fetch: async request => {
      requests.push(typeof request === 'string' ? request : request.url);
      return network ? network(request, requests.length) : new Response('public code');
    }
  });
  vm.runInContext(source, context, { filename: 'sw.js' });
  const request = (url, options = {}) => {
    let promise;
    handlers.get('fetch')({ request: { method: 'GET', mode: 'cors', url, ...options }, respondWith(value) { promise = value; } });
    return promise;
  };
  const activate = () => {
    let promise;
    handlers.get('activate')({ waitUntil(value) { promise = value; } });
    return promise;
  };
  return { request, activate, store, stores, deleted, requests, get claimed() { return claimed; } };
}

async function test(name, body) {
  await body(); passed++; console.log(`PASS ${name}`);
}

await test('cached app shell handles HTTP 5xx and network failures', async () => {
  for (const status of [500, 503, 504, 'offline']) {
    const app = fixture({ network: () => {
      if (status === 'offline') throw new TypeError('Offline');
      return new Response('upstream failure', { status });
    } });
    app.store(shellName).set(base + 'app.js', new Response('saved app'));
    const response = await app.request(base + 'app.js');
    assert.equal(response.status, 200); assert.equal(await response.text(), 'saved app');
  }
});

await test('navigation can use the saved index on a server failure', async () => {
  const app = fixture({ network: () => new Response('failure', { status: 503 }) });
  app.store(shellName).set(base + 'index.html', new Response('saved index'));
  assert.equal(await (await app.request(base, { mode: 'navigate' })).text(), 'saved index');
});

await test('HTTP 4xx is not replaced by stale success and a missing 5xx cache preserves its error', async () => {
  for (const status of [401, 403, 404, 503]) {
    const app = fixture({ network: () => new Response('real error', { status }) });
    if (status < 500) app.store(shellName).set(base + 'app.js', new Response('old code'));
    const response = await app.request(base + 'app.js');
    assert.equal(response.status, status); assert.equal(await response.text(), 'real error');
  }
});

await test('optional cache failures cannot hide a successful app or SDK fetch', async () => {
  for (const options of [{ failOpen: true }, { failWrite: true }]) {
    const app = fixture(options);
    for (const url of [base + 'app.js', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.min.js']) {
      const response = await app.request(url);
      assert.equal(response.status, 200); assert.equal(await response.text(), 'public code');
    }
  }
});

await test('pinned ORT JS MJS WASM and TF/TM runtimes are reused without network', async () => {
  const urls = [
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.min.js',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.mjs',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm',
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js'
  ];
  let online = true;
  const app = fixture({ network: () => { if (!online) throw new TypeError('Offline'); return new Response('pinned runtime'); } });
  for (const url of urls) assert.equal(await (await app.request(url)).text(), 'pinned runtime');
  online = false;
  for (const url of urls) assert.equal(await (await app.request(url)).text(), 'pinned runtime');
  assert.deepEqual(app.requests, urls);
  assert.deepEqual([...app.store(sdkName).keys()].sort(), [...urls].sort());
});

await test('private data, model binaries and unrelated runtime versions are not intercepted', async () => {
  const app = fixture();
  const ignored = [
    base + 'photos/student-leaf.jpg',
    base + 'api/results',
    'https://example.firebaseio.com/users/student.json',
    'https://example.firebaseapp.com/__/auth/handler',
    'https://huggingface.co/rodynaemad/plant-disease-dinov2-small/resolve/main/onnx/model_with_features_quantized.onnx',
    'https://teachablemachine.withgoogle.com/models/student/model.json',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@latest/dist/ort.min.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.21.0/dist/tf.min.js',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.min.js?other=1'
  ];
  for (const url of ignored) assert.equal(app.request(url), undefined, url);
  assert.equal(app.request(base + 'app.js', { method: 'POST' }), undefined);
  assert.equal(app.requests.length, 0); assert.equal(app.stores.size, 0);
});

await test('activation preserves verified model bytes and current caches across app updates', async () => {
  const app = fixture();
  const keep = [shellName, sdkName, aiName, 'unrelated-cache'];
  for (const name of [...keep, 'ecoplant-shell-v11-ecoplant-leaf-health', 'ecoplant-sdk-v11-ecoplant-leaf-health']) app.store(name);
  app.store(aiName).set('public-model', new Response('verified bytes'));
  await app.activate();
  assert.deepEqual([...app.stores.keys()].sort(), keep.sort());
  assert.equal(await app.store(aiName).get('public-model').clone().text(), 'verified bytes');
  assert.equal(app.claimed, 1);
});

console.log(`\n${passed} service-worker availability and cache privacy tests passed.`);
