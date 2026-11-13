import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';

// Explicit transport/runtime fixtures exercise the public contract and resource
// lifecycle. These mocks do not validate the real weights or model accuracy.
const productionSource = fs.readFileSync(new URL('../dist/plant-ai.js', import.meta.url), 'utf8');
const modelURL = 'https://huggingface.co/rodynaemad/plant-disease-dinov2-small/resolve/06ebf5e308e100fd000d738c42b059ebb5f58a16/onnx/model_with_features_quantized.onnx';
const centroidURL = 'https://huggingface.co/spaces/rodynaemad/plant-disease-scanner/resolve/b26e704bd72c2fe05632ea6f7be680a2eca0d8f5/centroids.f32';
const modelFixture = new TextEncoder().encode('EXPLICIT MOCK: no trained model weights');
const image = { width: 640, height: 480 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const assetCacheName = 'ecoplant-ai-verified-v1';
let serial = 0, passed = 0;
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(error));

function centroidsFixture() {
  const values = new Float32Array(38 * 768);
  for (let i = 0; i < 38; i++) values[i * 768 + i] = 1;
  return new Uint8Array(values.buffer);
}
function outputFixture({ top = 0, ood = false, uncertain = false } = {}) {
  const logits = new Float32Array(38).fill(-5), features = new Float32Array(768);
  logits[top] = 8;
  if (uncertain) logits.fill(0);
  features[ood ? 767 : top] = 1;
  return {
    logits: { data: logits, dims: [1, 38], disposed: 0, dispose() { this.disposed++; } },
    features: { data: features, dims: [1, 768], disposed: 0, dispose() { this.disposed++; } }
  };
}
function assetCacheFixture({ openError = false, writeError = false } = {}) {
  const saved = new Map(), deleted = [], opened = [];
  const cache = {
    async match(url) { return saved.get(url)?.clone(); },
    async put(url, response) {
      if (writeError) throw new DOMException('Storage is full', 'QuotaExceededError');
      saved.set(url, response.clone());
    },
    async delete(url) { deleted.push(url); return saved.delete(url); }
  };
  const storage = { async open(name) {
    opened.push(name);
    assert.equal(name, assetCacheName, 'only the dedicated public asset cache is used');
    if (openError) throw new DOMException('Storage unavailable', 'SecurityError');
    return cache;
  } };
  return { storage, saved, deleted, opened };
}
async function fresh(options = {}) {
  const centroids = options.centroids || centroidsFixture();
  const assets = [
    { name: 'model', url: modelURL, bytes: modelFixture.length, sha256: checksum(modelFixture) },
    { name: 'centroids', url: centroidURL, bytes: centroids.length, sha256: checksum(centroids) }
  ];
  const calls = { fetch: [], creates: [], runs: [], tensors: [], outputs: [], draw: [], scripts: [], releases: 0 };
  const session = {
    inputNames: ['pixel_values'], outputNames: ['logits', 'features'],
    async run(feeds) {
      calls.runs.push(feeds);
      const output = options.run ? await options.run(feeds, calls) : outputFixture(options);
      calls.outputs.push(output);
      return output;
    },
    async release() { calls.releases++; },
    ...options.session
  };
  const runtime = {
    env: { versions: { web: '1.30.0' }, wasm: {} },
    Tensor: class {
      constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; this.disposed = 0; calls.tensors.push(this); }
      dispose() { this.disposed++; }
    },
    InferenceSession: { async create(bytes, config) { calls.creates.push({ bytes, config }); return options.create ? options.create(session, calls) : session; } }
  };
  globalThis.ort = options.noRuntime ? undefined : runtime;
  globalThis.caches = options.cacheStorage;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  globalThis.document = {
    createElement(name) {
      if (name === 'script') return { remove() { this.removed = true; } };
      assert.equal(name, 'canvas');
      return { width: 0, height: 0, getContext() {
        if (options.noCanvas) return null;
        return { drawImage(...args) { calls.draw.push(args); }, getImageData() {
          const data = new Uint8ClampedArray(224 * 224 * 4);
          for (let i = 0; i < data.length; i += 4) { data[i] = 128; data[i + 1] = 64; data[i + 2] = 32; data[i + 3] = 255; }
          return { data };
        } };
      } };
    },
    head: { appendChild(script) {
      calls.scripts.push(script);
      queueMicrotask(() => {
        if (options.scriptError?.(calls.scripts.length)) script.onerror?.();
        else { globalThis.ort = runtime; script.onload?.(); }
      });
    } }
  };
  const respond = (url, init = {}) => {
    const body = init.body || (url === modelURL ? modelFixture : centroids);
    return new Response(body, { status: init.status || 200, headers: { 'content-length': String(body.byteLength), ...(init.headers || {}) } });
  };
  globalThis.fetch = async (url, init) => {
    assert.ok([modelURL, centroidURL].includes(url), 'only fixed trusted assets may be fetched');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
    calls.fetch.push({ url, init });
    return options.fetch ? options.fetch(url, init, calls, respond) : respond(url);
  };
  let source = productionSource.replace(/const ASSETS = Object\.freeze\(\[[\s\S]*?\]\);/, `const ASSETS = Object.freeze(${JSON.stringify(assets)});`);
  assert.notEqual(source, productionSource, 'mock fixture replacement must be explicit');
  if (options.loadTimeout) source = source.replace('const LOAD_TIMEOUT = 120000;', `const LOAD_TIMEOUT = ${options.loadTimeout};`);
  if (options.inferenceTimeout) source = source.replace('const INFERENCE_TIMEOUT = 45000;', `const INFERENCE_TIMEOUT = ${options.inferenceTimeout};`);
  source = source.replace("'./plant-health.js'", JSON.stringify(new URL('../dist/plant-health.js', import.meta.url).href));
  const api = await import(`data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=plant-ai-fixture-${++serial}.js`).toString('base64')}`);
  return { api, calls, session, runtime };
}
async function test(name, body) {
  await body();
  await tick();
  passed++;
  console.log(`PASS ${name}`);
}
const code = expected => error => error.code === `plant-ai/${expected}`;

await test('fixed provenance, metadata, progress and WASM-only runtime', async () => {
  assert.match(productionSource, /907fe4ed9d5f3fa6f6f6a9321a4564766e5136a2f316a2b23c930c3bfa13d72b/);
  assert.match(productionSource, /e873c9330db03dddf31e1f73db8fcb0bc4a186b69ff4d944aaec703beeeb5e51/);
  const { api, calls, runtime } = await fresh(), progress = [];
  const info = await api.loadPlantAI((...args) => progress.push(args));
  assert.equal(info.labels.length, 38);
  assert.equal(info.labels[0], 'Apple___Apple_scab');
  assert.equal(info.labels[37], 'Tomato___healthy');
  assert.equal(info.modelName, 'EcoPlant IA · DINOv2 PlantVillage');
  assert.equal(info.modelURL, 'https://huggingface.co/rodynaemad/plant-disease-dinov2-small');
  assert.equal(info.license, 'CC-BY-SA-4.0');
  assert.equal(calls.fetch.length, 2);
  assert.deepEqual(calls.creates[0].config.executionProviders, ['wasm']);
  assert.equal(runtime.env.wasm.numThreads, 1);
  assert.equal(runtime.env.wasm.wasmPaths, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/');
  assert.ok(progress.some(([, stage, details]) => stage === 'download' && details.percent === 100));
  assert.ok(progress.some(([, stage]) => stage === 'ready'));
  api.clearPlantAI(); await tick(); assert.equal(calls.releases, 1);
});

await test('concurrent loads share one cache and isolate caller metadata', async () => {
  const { api, calls } = await fresh();
  const [first, second] = await Promise.all([api.loadPlantAI(), api.loadPlantAI()]);
  first.labels[0] = 'Changed by consumer';
  assert.equal(second.labels[0], 'Apple___Apple_scab');
  assert.equal(calls.creates.length, 1); assert.equal(calls.fetch.length, 2);
  await api.loadPlantAI(); assert.equal(calls.fetch.length, 2);
  api.clearPlantAI();
});

await test('verified public assets survive a module reload and work without network', async () => {
  const persistent = assetCacheFixture();
  const first = await fresh({ cacheStorage: persistent.storage });
  await first.api.loadPlantAI(); await tick();
  assert.deepEqual([...persistent.saved.keys()].sort(), [modelURL, centroidURL].sort());
  first.api.clearPlantAI(); await tick();
  assert.equal(persistent.saved.size, 2, 'clearing the tab does not delete public downloaded weights');
  const second = await fresh({ cacheStorage: persistent.storage, fetch: () => { throw new TypeError('Offline'); } });
  const stages = [];
  const result = await second.api.classifyPlantAI(image, (_message, stage) => stages.push(stage));
  assert.equal(result.topClass, 'Apple___Apple_scab');
  assert.equal(second.calls.fetch.length, 0);
  assert.equal(second.calls.creates.length, 1);
  assert.ok(stages.includes('cache'));
  second.api.clearPlantAI();
});

await test('cached assets are revalidated by hash and size and only damaged entries refetch', async () => {
  for (const damage of ['hash', 'size']) {
    const persistent = assetCacheFixture();
    const wrong = modelFixture.slice(0, damage === 'size' ? -1 : undefined);
    if (damage === 'hash') wrong[0] ^= 1;
    persistent.saved.set(modelURL, new Response(wrong));
    persistent.saved.set(centroidURL, new Response(centroidsFixture()));
    const { api, calls } = await fresh({ cacheStorage: persistent.storage });
    await api.loadPlantAI(); await tick();
    assert.deepEqual(persistent.deleted, [modelURL]);
    assert.deepEqual(calls.fetch.map(item => item.url), [modelURL]);
    const repaired = new Uint8Array(await persistent.saved.get(modelURL).clone().arrayBuffer());
    assert.equal(checksum(repaired), checksum(modelFixture));
    api.clearPlantAI(); await tick();
  }
});

await test('unavailable storage and quota failures do not prevent inference', async () => {
  for (const cacheOptions of [{ openError: true }, { writeError: true }]) {
    const persistent = assetCacheFixture(cacheOptions);
    const { api, calls } = await fresh({ cacheStorage: persistent.storage });
    const result = await api.classifyPlantAI(image);
    assert.equal(result.topClass, 'Apple___Apple_scab');
    assert.equal(calls.fetch.length, 2);
    await tick(); assert.equal(persistent.saved.size, 0);
    api.clearPlantAI(); await tick();
  }
});

await test('valid disease output preserves raw labels, real scores and preprocessing', async () => {
  const { api, calls } = await fresh();
  const result = await api.classifyPlantAI(image, () => { throw new Error('Display-only failure'); });
  assert.equal(result.method, 'plant-ai'); assert.equal(result.topClass, 'Apple___Apple_scab');
  assert.equal(result.title, 'Sinais de possível doença');
  assert.equal(result.severity, 'attention'); assert.equal(result.predictions.length, 3);
  assert.equal(result.confidence, result.predictions[0].probability);
  assert.ok(result.confidence > 0.99 && result.confidence < 1);
  assert.ok(result.predictions.every((value, i, all) => !i || all[i - 1].probability >= value.probability));
  assert.deepEqual(calls.tensors[0].dims, [1, 3, 224, 224]);
  assert.ok(Math.abs(calls.tensors[0].data[0] - (128 / 255 - .485) / .229) < 1e-6);
  assert.ok(Math.abs(calls.tensors[0].data[224 * 224] - (64 / 255 - .456) / .224) < 1e-6);
  assert.deepEqual(calls.draw[0].slice(1), [-58, -16, 341, 256]);
  assert.equal(calls.tensors[0].disposed, 1); assert.equal(calls.outputs[0].logits.disposed, 1);
  const allowed = new Set(['method','title','topClass','confidence','predictions','modelLabels','modelName','modelURL','summary','care','disclaimer','severity','analyzedAt','possibilities']);
  for (const key of Object.keys(result)) assert.ok(allowed.has(key), `RTDB-compatible field ${key}`);
  assert.ok(result.title.length <= 400 && result.disclaimer.length <= 5000 && result.care.length <= 20);
  api.clearPlantAI();
});

await test('healthy class is qualified and remains an observation', async () => {
  const { api } = await fresh({ top: 37 });
  const result = await api.classifyPlantAI(image);
  assert.equal(result.topClass, 'Tomato___healthy'); assert.equal(result.severity, 'observe');
  assert.equal(result.title, 'Aparência saudável');
  assert.match(result.summary, /não descarta/); assert.ok(result.confidence > .5);
  assert.equal(api.describePlantSpecies(result).name, 'Tomateiro');
  assert.match(api.describePlantSpecies(result).summary, /Solanum lycopersicum/);
  api.clearPlantAI();
});

await test('high softmax outside the known leaf distribution yields no disease or score', async () => {
  const { api } = await fresh({ ood: true });
  const result = await api.classifyPlantAI(image);
  assert.equal(result.title, 'Análise inconclusiva'); assert.equal(result.topClass, 'Análise inconclusiva');
  assert.equal(result.severity, 'observe');
  assert.ok(!Object.hasOwn(result, 'confidence')); assert.ok(!Object.hasOwn(result, 'predictions'));
  assert.match(result.summary, /Nenhuma doença/);
  assert.equal(api.describePlantSpecies(result).status, 'inconclusive');
  assert.equal(api.describePlantSpecies(result).name, 'Espécie não identificada');
  assert.doesNotMatch(api.describePlantSpecies(result).summary, /\d+[,.]\d+%|Macieira/);
  api.clearPlantAI();
});

await test('uncertain closed-set classification also abstains', async () => {
  const { api } = await fresh({ uncertain: true });
  const result = await api.classifyPlantAI(image);
  assert.equal(result.title, 'Análise inconclusiva'); assert.ok(!('confidence' in result));
  api.clearPlantAI();
});

await test('moderate confidence is stored as inconclusive without stale disease scores', async () => {
  const { api } = await fresh({ run() {
    const outputs = outputFixture();
    outputs.logits.data.fill(0);
    outputs.logits.data[0] = Math.log(0.65 * 37 / (1 - 0.65));
    return outputs;
  } });
  const result = await api.classifyPlantAI(image);
  assert.equal(result.title, 'Análise inconclusiva');
  assert.equal(result.topClass, 'Análise inconclusiva');
  assert.ok(!('confidence' in result) && !('predictions' in result));
  assert.doesNotMatch(result.summary, /sarna/i);
  api.clearPlantAI();
});

await test('species aggregates all class scores even when no disease is certain', async () => {
  const { api } = await fresh({ run() {
    const outputs = outputFixture({ top: 28 });
    outputs.logits.data.fill(-20);
    for (const index of [28, 29, 30, 31]) outputs.logits.data[index] = Math.log(.22);
    outputs.logits.data[0] = Math.log(.12);
    return outputs;
  } });
  const result = await api.classifyPlantAI(image);
  assert.equal(result.title, 'Análise inconclusiva', 'uncertain disease must remain uncertain');
  assert.ok(!('confidence' in result) && !('predictions' in result));
  const species = api.describePlantSpecies(result);
  assert.equal(species.status, 'identified');
  assert.equal(species.name, 'Tomateiro');
  assert.match(species.summary, /88,0%/);
  assert.match(species.summary, /Solanum lycopersicum/);
  assert.deepEqual(Object.keys(result.possibilities[0]).sort(), ['name', 'reason']);
  api.clearPlantAI();
});

await test('ambiguous crops do not produce a forced species', async () => {
  const { api } = await fresh({ run() {
    const outputs = outputFixture();
    outputs.logits.data.fill(-20);
    outputs.logits.data[0] = Math.log(.6);
    outputs.logits.data[37] = Math.log(.4);
    return outputs;
  } });
  const result = await api.classifyPlantAI(image);
  assert.equal(api.describePlantSpecies(result).status, 'inconclusive');
  assert.equal(result.possibilities[0].name, 'Espécie não identificada');
  api.clearPlantAI();
});

await test('broad crop groups preserve botanical ambiguity', async () => {
  for (const [top, common, genus] of [[4, 'Mirtilo', 'Vaccinium spp.'], [5, 'Cerejeira', 'Prunus spp.'], [25, 'Abóbora', 'Cucurbita spp.']]) {
    const { api } = await fresh({ top });
    const result = await api.classifyPlantAI(image);
    const species = api.describePlantSpecies(result);
    assert.equal(species.name, common);
    assert.ok(species.summary.includes(genus));
    assert.match(species.summary, /não diferencia a espécie exata/);
    assert.ok(result.predictions.length <= 3);
    api.clearPlantAI();
  }
});

await test('species helper accepts only the explicit recognized metadata contract', async () => {
  const { api } = await fresh();
  for (const result of [null, {}, { possibilities: 'invalid' }, { possibilities: [{ name: 'Espécie provável: Inventada', reason: 'Not recognized' }] }, { possibilities: [{ name: 'Espécie provável: Tomateiro', reason: '' }] }]) {
    assert.equal(api.describePlantSpecies(result).status, 'unassessed');
  }
  const result = { method: 'teachable-machine', possibilities: [{ name: 'Espécie provável: Tomateiro', reason: 'Referência botânica: Solanum lycopersicum.' }] };
  assert.equal(api.describePlantSpecies(result).status, 'identified', 'combined TM report can carry measured DINO species feedback');
});

await test('invalid output dimensions/NaN never become a report; tensors are freed', async () => {
  for (const malformed of ['shape', 'nan']) {
    const { api, calls } = await fresh({ run: async () => { const out = outputFixture(); if (malformed === 'shape') out.logits.dims = [1, 37]; else out.features.data[0] = NaN; return out; } });
    await assert.rejects(api.classifyPlantAI(image), code('inference'));
    assert.equal(calls.tensors[0].disposed, 1); assert.equal(calls.outputs[0].features.disposed, 1);
    api.clearPlantAI(); await tick();
  }
});

await test('invalid image and missing canvas fail without a fabricated result', async () => {
  for (const noCanvas of [false, true]) {
    const { api, calls } = await fresh({ noCanvas });
    await assert.rejects(api.classifyPlantAI(noCanvas ? image : { width: 0, height: 0 }), code('invalid-image'));
    assert.equal(calls.runs.length, 0); api.clearPlantAI(); await tick();
  }
});

await test('503 then 200 retries the real asset transport and reports progress', async () => {
  let attempts = 0;
  const { api, calls } = await fresh({ fetch: (url, _init, _calls, respond) => url === modelURL && ++attempts === 1 ? respond(url, { status: 503 }) : respond(url) });
  const stages = []; await api.loadPlantAI((_message, stage) => stages.push(stage));
  assert.equal(calls.fetch.filter(item => item.url === modelURL).length, 2);
  assert.ok(stages.includes('retry')); api.clearPlantAI();
});

await test('persistent 503 has a bounded three-attempt error without session creation', async () => {
  const { api, calls } = await fresh({ fetch: (url, _init, _calls, respond) => respond(url, { status: url === modelURL ? 503 : 200 }) });
  await assert.rejects(api.loadPlantAI(), code('model-temporarily-unavailable'));
  assert.equal(calls.fetch.filter(item => item.url === modelURL).length, 3);
  assert.equal(calls.creates.length, 0); api.clearPlantAI();
});

await test('403 and 404 are not retried', async () => {
  for (const status of [403, 404]) {
    const { api, calls } = await fresh({ fetch: (url, _init, _calls, respond) => respond(url, { status: url === modelURL ? status : 200 }) });
    await assert.rejects(api.loadPlantAI(), code(status === 403 ? 'model-access-denied' : 'model-unavailable'));
    assert.equal(calls.fetch.filter(item => item.url === modelURL).length, 1);
    assert.equal(calls.creates.length, 0); api.clearPlantAI(); await tick();
  }
});

await test('corrupt or truncated downloads never load a model', async () => {
  for (const truncated of [false, true]) {
    const persistent = assetCacheFixture();
    const wrong = modelFixture.slice(0, truncated ? -1 : undefined); wrong[0] ^= 1;
    const { api, calls } = await fresh({ cacheStorage: persistent.storage, fetch: (url, _init, _calls, respond) => respond(url, url === modelURL ? { body: wrong } : {}) });
    await assert.rejects(api.loadPlantAI(), code('invalid-model'));
    await tick(); assert.equal(persistent.saved.has(modelURL), false, 'unverified weights must never be persisted');
    assert.equal(calls.creates.length, 0); api.clearPlantAI(); await tick();
  }
});

await test('centroid dimensionality and normalization are validated', async () => {
  const bad = centroidsFixture(); new Float32Array(bad.buffer)[0] = 2;
  const { api, calls } = await fresh({ centroids: bad });
  await assert.rejects(api.loadPlantAI(), code('invalid-model'));
  assert.equal(calls.creates.length, 0); api.clearPlantAI();
});

await test('invalid session interface is released', async () => {
  const { api, calls } = await fresh({ session: { outputNames: ['only_logits'] } });
  await assert.rejects(api.loadPlantAI(), code('invalid-model'));
  await tick(); assert.equal(calls.releases, 1); api.clearPlantAI();
});

await test('pre-cancelled request performs no downloads', async () => {
  const { api, calls } = await fresh(); const controller = new AbortController(); controller.abort();
  await assert.rejects(api.loadPlantAI(null, { signal: controller.signal }), code('cancelled'));
  assert.equal(calls.fetch.length, 0); api.clearPlantAI();
});

await test('cancelling retry backoff does not make another request', async () => {
  const { api, calls } = await fresh({ fetch: (url, _init, _calls, respond) => respond(url, { status: 503 }) });
  const controller = new AbortController();
  const task = api.loadPlantAI((_message, stage) => { if (stage === 'retry') controller.abort(); }, { signal: controller.signal });
  await assert.rejects(task, code('cancelled')); await tick();
  assert.ok(calls.fetch.length <= 2); assert.equal(calls.creates.length, 0); api.clearPlantAI();
});

await test('one cancelled subscriber does not cancel another model loader', async () => {
  const gate = deferred(), started = deferred();
  const { api, calls, session } = await fresh({ create: value => { started.resolve(); return gate.promise; } });
  const controller = new AbortController();
  const first = api.loadPlantAI(null, { signal: controller.signal }), firstRejected = assert.rejects(first, code('cancelled'));
  const second = api.loadPlantAI(); await started.promise; controller.abort();
  await firstRejected; gate.resolve(session);
  assert.equal((await second).labels.length, 38); assert.equal(calls.releases, 0);
  api.clearPlantAI();
});

await test('cancel during uninterruptible session creation frees the late session', async () => {
  const gate = deferred(), started = deferred();
  const { api, calls, session } = await fresh({ create: () => { started.resolve(); return gate.promise; } });
  const controller = new AbortController();
  const task = api.loadPlantAI(null, { signal: controller.signal });
  const rejected = assert.rejects(task, code('cancelled')); await started.promise; controller.abort();
  await rejected; assert.equal(calls.releases, 0);
  gate.resolve(session); await tick(); await tick(); assert.equal(calls.releases, 1);
  api.clearPlantAI(); assert.equal(calls.releases, 1);
});

await test('clear during inference delays session release until the run really finishes', async () => {
  const gate = deferred(), started = deferred();
  const { api, calls } = await fresh({ run: () => { started.resolve(); return gate.promise; } });
  const task = api.classifyPlantAI(image), rejected = assert.rejects(task, code('cancelled'));
  await started.promise; api.clearPlantAI(); await rejected;
  assert.equal(calls.releases, 0); assert.equal(calls.tensors[0].disposed, 0);
  gate.resolve(outputFixture()); await tick(); await tick();
  assert.equal(calls.releases, 1); assert.equal(calls.tensors[0].disposed, 1);
  const info = await api.loadPlantAI(); assert.equal(info.labels.length, 38); assert.equal(calls.creates.length, 2);
  api.clearPlantAI();
});

await test('caller inference cancellation does not dispose a reusable cached session', async () => {
  const gate = deferred(), started = deferred();
  const { api, calls } = await fresh({ run: () => { started.resolve(); return gate.promise; } });
  const controller = new AbortController(), task = api.classifyPlantAI(image, null, { signal: controller.signal });
  const rejected = assert.rejects(task, code('cancelled')); await started.promise; controller.abort(); await rejected;
  assert.equal(calls.releases, 0); gate.resolve(outputFixture()); await tick();
  assert.equal(calls.tensors[0].disposed, 1); assert.equal(calls.releases, 0);
  await api.loadPlantAI(); assert.equal(calls.creates.length, 1); api.clearPlantAI();
});

await test('load timeout aborts waiting transport with a readable error', async () => {
  const { api, calls } = await fresh({ loadTimeout: 30, fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })) });
  await assert.rejects(api.loadPlantAI(), code('timeout'));
  assert.ok(calls.fetch.every(item => item.init.signal.aborted)); assert.equal(calls.creates.length, 0); api.clearPlantAI();
});

await test('inference timeout discards late output and safely releases after clear', async () => {
  const gate = deferred();
  const { api, calls } = await fresh({ inferenceTimeout: 30, run: () => gate.promise });
  await assert.rejects(api.classifyPlantAI(image), code('timeout'));
  api.clearPlantAI(); assert.equal(calls.releases, 0);
  gate.resolve(outputFixture()); await tick(); await tick(); assert.equal(calls.releases, 1);
});

await test('runtime script is pinned and retries a transient script failure', async () => {
  const { api, calls } = await fresh({ noRuntime: true, scriptError: attempt => attempt === 1 });
  await api.loadPlantAI(); assert.equal(calls.scripts.length, 2);
  assert.equal(calls.scripts[0].src, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.js');
  assert.equal(calls.scripts[0].removed, true); api.clearPlantAI();
});

await tick();
assert.deepEqual(unhandled, [], 'no unhandled abort/retry/inference rejections');
console.log(`\n${passed} plant-ai contract tests passed (explicit mocks; not an accuracy evaluation).`);
