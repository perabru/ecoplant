import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import fs from 'node:fs';

// Contract/lifecycle tests with explicit TM and network mocks. No trained weights
// are executed here; model accuracy requires the real EcoPlant export.
const moduleURL = new URL('../dist/classifier.js', import.meta.url);
const productionSource = fs.readFileSync(moduleURL, 'utf8');
const bundledURL = new URL('./my_model/', moduleURL).href;
const labels = ['Saudável', 'Mancha foliar'];
const metadata = { labels, packageName: '@teachablemachine/image', modelName: 'Modelo de teste' };
const topology = { modelTopology: { class_name: 'Sequential' }, weightsManifest: [{ paths: ['weights.bin'], weights: [] }] };
const probabilities = [{ className: labels[0], probability: 0.8 }, { className: labels[1], probability: 0.2 }];
const canvas = { tagName: 'CANVAS', width: 224, height: 224 };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
let instance = 0;
let passed = 0;
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(error));

function mockModel(overrides = {}) {
  const model = {
    disposed: 0,
    getTotalClasses: () => labels.length,
    getClassLabels: () => [...labels],
    predict: async () => probabilities.map(item => ({ ...item })),
    dispose: () => { throw new Error('Do not call the broken TM wrapper disposal.'); },
    ...overrides
  };
  model.model = { dispose: () => { model.disposed += 1; } };
  return model;
}

function exportedFiles({ meta = metadata, graph = topology, weightName = 'weights.bin' } = {}) {
  return [
    new File([JSON.stringify(graph)], 'model.json', { type: 'application/json' }),
    new File([JSON.stringify(meta)], 'metadata.json', { type: 'application/json' }),
    new File(['EXPLICIT MOCK: not trained model weights'], weightName, { type: 'application/octet-stream' })
  ];
}

function responseFor(url, options = {}) {
  const status = options.status ?? 200;
  const value = options.json ?? (url.endsWith('/metadata.json') ? metadata : topology);
  const bytes = Uint8Array.from(options.bytes ?? [1, 2, 3, 4]);
  const headers = { 'content-length': '100', ...(options.headers || {}) };
  return {
    ok: status >= 200 && status < 300, status, url: options.url ?? url,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => options.text ?? JSON.stringify(value),
    arrayBuffer: async () => bytes.buffer
  };
}

async function fresh(options = {}) {
  const calls = { fetch: [], load: [], files: [], models: [], wrappers: [], backends: [] };
  let backend = options.backend ?? 'cpu';
  globalThis.tf = {
    io: { fromMemory: artifacts => ({ artifacts }) },
    async loadLayersModel(handler, loadOptions) {
      calls.load.push({ artifacts: handler.artifacts, options: loadOptions });
      const model = options.load ? await options.load(handler.artifacts) : mockModel(options.model);
      calls.models.push(model);
      return { dispose: () => model.model.dispose(), wrapper: model };
    },
    ready: async () => { if (options.ready) await options.ready(backend); },
    getBackend: () => backend,
    setBackend: async name => {
      calls.backends.push(name);
      const accepted = options.setBackend ? await options.setBackend(name) : true;
      if (accepted !== false) backend = name;
      return accepted;
    }
  };
  globalThis.tmImage = {
    load: () => { throw new Error('Hidden network through tmImage.load is forbidden in this contract.'); },
    CustomMobileNet: class {
      constructor(layers, meta) {
        calls.wrappers.push({ layers, metadata: meta });
        if (options.wrapperError) throw options.wrapperError;
        return layers.wrapper;
      }
    },
    async loadFromFiles(modelFile, weightsFile, metadataFile) {
      calls.files.push({ modelFile, weightsFile, metadataFile });
      const model = options.loadFromFiles ? await options.loadFromFiles(modelFile, weightsFile, metadataFile) : mockModel(options.model);
      calls.models.push(model);
      return model;
    }
  };
  globalThis.fetch = async (url, fetchOptions) => {
    calls.fetch.push({ url, options: fetchOptions });
    if (options.fetch) return options.fetch(url, fetchOptions);
    return responseFor(url, {
      url: options.redirect ? options.redirect(url) : url,
      json: url.endsWith('/metadata.json') ? (options.metadata || metadata) : (options.topology || topology)
    });
  };
  // Inject configuration into an isolated in-memory module, never production files.
  const fixtureSource = productionSource
    .replace("import { MODEL_CONFIG } from './model-config.js';", `const MODEL_CONFIG = Object.freeze({bundledModelAvailable:${options.bundledAvailable ?? true}});`)
    .replaceAll('import.meta.url', JSON.stringify(moduleURL.href));
  assert(!fixtureSource.includes("from './model-config.js'"));
  const api = await import('data:text/javascript;base64,' + Buffer.from(`// isolated fixture ${++instance}\n${fixtureSource}`).toString('base64'));
  return { api, calls };
}

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`OK ${name}`);
}

await check('Official URLs and the exact bundled folder are accepted; unsafe paths are rejected', async () => {
  const { api } = await fresh();
  assert.equal(api.BUNDLED_MODEL_URL, './my_model/');
  assert.equal(api.IMPORTED_MODEL_URL, 'local:ecoplant-model');
  assert.equal(api.validateModelURL(api.BUNDLED_MODEL_URL), bundledURL);
  assert.equal(api.validateModelURL(bundledURL), bundledURL);
  for (const suffix of ['', '/', '/model.json']) {
    assert.equal(api.validateModelURL(`https://teachablemachine.withgoogle.com/models/test_A-1${suffix}`), 'https://teachablemachine.withgoogle.com/models/test_A-1/');
  }
  for (const url of [null, '', './my_model/model.json', '../my_model/', './other/../my_model/', '/my_model/',
    'https://example.com/my_model/', bundledURL + 'model.json', bundledURL + '?x=1',
    'http://teachablemachine.withgoogle.com/models/x/', 'https://user@teachablemachine.withgoogle.com/models/x/',
    'https://teachablemachine.withgoogle.com/models/x/../y/', 'https://teachablemachine.withgoogle.com/models/%78/',
    'https://teachablemachine.withgoogle.com/models/x/?x=1', 'https://teachablemachine.withgoogle.com/models/x/#y']) {
    assert.throws(() => api.validateModelURL(url), { code: 'classifier/invalid-model-url' }, String(url));
  }
  assert.throws(() => api.validateModelURL(api.IMPORTED_MODEL_URL), { code: 'classifier/model-files-missing' });
});

await check('Bundled loading uses the existing photo pipeline and copies metadata labels', async () => {
  const { api, calls } = await fresh();
  const info = await api.loadPlantModel(api.BUNDLED_MODEL_URL);
  assert.equal(info.source, 'bundled');
  assert.equal(info.modelURL, bundledURL);
  assert.deepEqual(calls.fetch.map(call => call.url).sort(), [bundledURL + 'metadata.json', bundledURL + 'model.json', bundledURL + 'weights.bin'].sort());
  assert.equal(calls.load[0].options.strict, true);
  assert.deepEqual(Array.from(new Uint8Array(calls.load[0].artifacts.weightData)), [1, 2, 3, 4]);
  info.labels[0] = 'changed'; info.metadata.labels[1] = 'changed';
  const result = await api.classifyPlant(canvas, api.BUNDLED_MODEL_URL);
  assert.equal(result.method, 'teachable-machine');
  assert.equal(result.topClass, labels[0]);
  assert.equal(result.confidence, 0.8);
  assert.deepEqual(result.modelLabels, labels);
  assert.equal(calls.load.length, 1);
  assert(!('source' in result), 'Firebase result schema must not acquire an unapproved property');
});

await check('Unavailable bundled configuration fails before all network and library work', async () => {
  const { api, calls } = await fresh({ bundledAvailable: false });
  assert.equal(api.validateModelURL(api.BUNDLED_MODEL_URL), bundledURL);
  await assert.rejects(api.loadPlantModel(api.BUNDLED_MODEL_URL), error => {
    assert.equal(error.code, 'classifier/model-not-configured');
    assert.match(error.message, /Perfil/); assert.match(error.message, /Teachable Machine/); return true;
  });
  await assert.rejects(api.classifyPlant(canvas, api.BUNDLED_MODEL_URL), { code: 'classifier/model-not-configured' });
  assert.equal(calls.fetch.length, 0); assert.equal(calls.load.length, 0); assert.equal(calls.files.length, 0);
});

await check('Missing bundled files produce actionable import/link instructions and permit retry', async () => {
  let missing = true;
  const { api, calls } = await fresh({ fetch: async url => responseFor(url, { status: missing ? 404 : 200 }) });
  await assert.rejects(api.loadPlantModel(api.BUNDLED_MODEL_URL), error => {
    assert.equal(error.code, 'classifier/model-files-missing');
    assert.match(error.message, /Perfil/); assert.match(error.message, /Teachable Machine/); return true;
  });
  assert.equal(calls.load.length, 0);
  missing = false;
  assert.equal((await api.loadPlantModel(api.BUNDLED_MODEL_URL)).source, 'bundled');
});

await check('Hosted multi-shard models and official storage redirects remain supported', async () => {
  const { api, calls } = await fresh({
    topology: { ...topology, weightsManifest: [{ paths: ['group1-shard1of2.bin', 'group1-shard2of2.bin'], weights: [] }] },
    redirect: url => url.replace('https://teachablemachine.withgoogle.com/models/', 'https://storage.googleapis.com/tm-model/')
  });
  assert.equal((await api.loadPlantModel('https://teachablemachine.withgoogle.com/models/shards/')).source, 'hosted');
  assert.equal(calls.load.length, 1);
  const bad = await fresh({ redirect: () => 'https://example.com/model.json' });
  await assert.rejects(bad.api.loadPlantModel('https://teachablemachine.withgoogle.com/models/redirect/'), { code: 'classifier/invalid-model' });
});

await check('503 recovery covers JSON and weights using only the same official model and filename', async () => {
  const base = 'https://teachablemachine.withgoogle.com/models/retry_same-ID/';
  const storage = 'https://storage.googleapis.com/tm-model/retry_same-ID/';
  const seen = new Map();
  const { api, calls } = await fresh({ fetch: async url => {
    const file = url.split('/').pop();
    const attempt = (seen.get(file) || 0) + 1; seen.set(file, attempt);
    assert([base + file, storage + file].includes(url));
    return responseFor(url, { status: attempt === 1 ? 503 : 200, headers: { 'retry-after': '0' } });
  } });
  const info = await api.loadPlantModel(base);
  assert.equal(info.modelURL, base, 'Mirror must not change analysis provenance');
  assert.equal(info.source, 'hosted');
  assert.deepEqual(Object.fromEntries(seen), { 'metadata.json': 2, 'model.json': 2, 'weights.bin': 2 });
  assert.equal(calls.load.length, 1);
  for (const file of seen.keys()) {
    assert.deepEqual(calls.fetch.filter(call => call.url.endsWith('/' + file)).map(call => call.url), [base + file, storage + file]);
  }
});

await check('Bundled transient failures retry the configured local resource without a mirror', async () => {
  let failures = 1;
  const { api, calls } = await fresh({ fetch: async url => responseFor(url, {
    status: url.endsWith('/model.json') && failures-- > 0 ? 503 : 200
  }) });
  await api.loadPlantModel(api.BUNDLED_MODEL_URL);
  assert(calls.fetch.every(call => call.url.startsWith(bundledURL)));
  assert.equal(calls.fetch.filter(call => call.url.endsWith('/model.json')).length, 2);
});

await check('Persistent JSON and weights 503 errors stop after three attempts', async () => {
  for (const failingFile of ['model.json', 'weights.bin']) {
    const { api, calls } = await fresh({ fetch: async url => responseFor(url, { status: url.endsWith('/' + failingFile) ? 503 : 200 }) });
    await assert.rejects(api.loadPlantModel('https://teachablemachine.withgoogle.com/models/outage/'), error => {
      assert.equal(error.code, 'classifier/model-temporarily-unavailable');
      assert.equal(error.status, 503); assert.equal(error.resource, failingFile); return true;
    });
    assert.equal(calls.fetch.filter(call => call.url.endsWith('/' + failingFile)).length, 3);
    assert.equal(calls.load.length, 0);
  }
});

await check('Network failure retries the exact official storage destination', async () => {
  const base = 'https://teachablemachine.withgoogle.com/models/network_case/';
  const { api, calls } = await fresh({ fetch: async url => {
    if (url === base + 'model.json') throw new TypeError('Explicit mocked network failure');
    return responseFor(url);
  } });
  await api.loadPlantModel(base);
  assert.deepEqual(calls.fetch.filter(call => call.url.endsWith('/model.json')).map(call => call.url), [
    base + 'model.json', 'https://storage.googleapis.com/tm-model/network_case/model.json'
  ]);
});

await check('Denied, missing and malformed resources are never retried or mirrored', async () => {
  for (const status of [401, 403, 404]) {
    const base = `https://teachablemachine.withgoogle.com/models/status_${status}/`;
    const { api, calls } = await fresh({ fetch: async url => responseFor(url, { status: url.endsWith('/model.json') ? status : 200 }) });
    await assert.rejects(api.loadPlantModel(base), { code: status === 404 ? 'classifier/model-unavailable' : 'classifier/model-access-denied' });
    assert.equal(calls.fetch.filter(call => call.url.endsWith('/model.json')).length, 1);
    assert(calls.fetch.every(call => call.url.startsWith(base)));
  }
  const invalid = await fresh({ fetch: async url => responseFor(url, { text: url.endsWith('/model.json') ? '<html>not JSON</html>' : undefined }) });
  await assert.rejects(invalid.api.loadPlantModel('https://teachablemachine.withgoogle.com/models/bad_json/'), { code: 'classifier/invalid-model' });
  assert.equal(invalid.calls.fetch.filter(call => call.url.endsWith('/model.json')).length, 1);
  const redirected = await fresh({ redirect: url => url.replace('/models/', '/tm-model/').replace('teachablemachine.withgoogle.com', 'storage.googleapis.com').replace('/exact_id/', '/another_id/') });
  await assert.rejects(redirected.api.loadPlantModel('https://teachablemachine.withgoogle.com/models/exact_id/'), { code: 'classifier/invalid-model' });
});

await check('429 retries stay on the same endpoint and do not use storage to avoid the limit', async () => {
  const base = 'https://teachablemachine.withgoogle.com/models/rate_limit/';
  let failures = 1;
  const { api, calls } = await fresh({ fetch: async url => responseFor(url, {
    status: url.endsWith('/model.json') && failures-- > 0 ? 429 : 200,
    headers: { 'retry-after': '0' }
  }) });
  await api.loadPlantModel(base);
  assert.equal(calls.fetch.filter(call => call.url.endsWith('/model.json')).length, 2);
  assert(calls.fetch.every(call => call.url.startsWith(base)));
});

await check('Cancellation interrupts Retry-After waits without sending another request', async () => {
  const controller = new AbortController();
  const { api, calls } = await fresh({ fetch: async url => responseFor(url, {
    status: url.endsWith('/model.json') ? 503 : 200, headers: { 'retry-after': '2' }
  }) });
  const began = performance.now();
  await assert.rejects(api.loadPlantModel('https://teachablemachine.withgoogle.com/models/cancel_wait/', (_message, stage) => {
    if (stage === 'retrying') setTimeout(() => controller.abort(), 10);
  }, { signal: controller.signal }), { code: 'classifier/cancelled' });
  assert(performance.now() - began < 1000, 'Abort should interrupt the two-second server wait');
  assert.equal(calls.fetch.filter(call => call.url.endsWith('/model.json')).length, 1);
  assert.equal(calls.load.length, 0);
});

await check('Shard order and weight specs reach fromMemory intact without hidden network', async () => {
  const graph = { ...topology, weightsManifest: [
    { paths: ['part1.bin', 'part2.bin'], weights: [{ name: 'first', shape: [1], dtype: 'float32' }] },
    { paths: ['part3.bin'], weights: [{ name: 'second', shape: [1], dtype: 'float32' }] }
  ] };
  const bytes = { 'part1.bin': [1, 2], 'part2.bin': [3, 4], 'part3.bin': [5, 6, 7, 8] };
  const { api, calls } = await fresh({ fetch: async url => responseFor(url, {
    json: url.endsWith('/metadata.json') ? metadata : graph,
    bytes: bytes[url.split('/').pop()]
  }) });
  await api.loadPlantModel('https://teachablemachine.withgoogle.com/models/shard_order/');
  assert.equal(calls.fetch.length, 5);
  assert.equal(calls.load.length, 1);
  assert.deepEqual(calls.load[0].artifacts.weightSpecs, graph.weightsManifest.flatMap(group => group.weights));
  assert.deepEqual(Array.from(new Uint8Array(calls.load[0].artifacts.weightData)), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(calls.load[0].options.strict, true);
});

await check('Wrapper construction failure releases the already loaded LayersModel', async () => {
  const { api, calls } = await fresh({ wrapperError: new Error('Explicit constructor failure') });
  await assert.rejects(api.loadPlantModel('https://teachablemachine.withgoogle.com/models/wrapper_error/'), { code: 'classifier/model-load-failed' });
  assert.equal(calls.models[0].disposed, 1);
});

await check('FileList import checks filenames, calls the correct TM API order and stays in memory', async () => {
  const { api, calls } = await fresh();
  const files = exportedFiles();
  const info = await api.loadPlantModelFromFiles({ 0: files[0], 1: files[1], 2: files[2], length: 3 }, undefined, { healthyClass: labels[0] });
  assert.equal(info.source, 'files'); assert.equal(info.modelURL, api.IMPORTED_MODEL_URL);
  assert.equal(api.validateModelURL(api.IMPORTED_MODEL_URL), api.IMPORTED_MODEL_URL);
  assert.equal(calls.fetch.length, 0); assert.equal(calls.load.length, 0);
  assert.equal(calls.files[0].modelFile, files[0]); assert.equal(calls.files[0].weightsFile, files[2]); assert.equal(calls.files[0].metadataFile, files[1]);
  assert.equal((await api.loadPlantModel(api.IMPORTED_MODEL_URL)).source, 'files');
  assert.equal((await api.classifyPlant(canvas, api.IMPORTED_MODEL_URL)).modelURL, api.IMPORTED_MODEL_URL);
  api.clearImportedPlantModel(); api.clearImportedPlantModel();
  assert.equal(calls.models[0].disposed, 1);
  assert.throws(() => api.validateModelURL(api.IMPORTED_MODEL_URL), { code: 'classifier/model-files-missing' });
});

await check('Missing, duplicate, mismatched and unrelated weights fail before library loading', async () => {
  const { api, calls } = await fresh();
  const files = exportedFiles();
  await assert.rejects(api.loadPlantModelFromFiles(files.slice(0, 2)), { code: 'classifier/model-files-missing' });
  await assert.rejects(api.loadPlantModelFromFiles([...files, files[0]]), { code: 'classifier/invalid-model-files' });
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles({ weightName: 'renamed.bin' })), { code: 'classifier/weights-name-mismatch' });
  await assert.rejects(api.loadPlantModelFromFiles([...files, new File(['mock'], 'other.bin')]), { code: 'classifier/unexpected-weight-files' });
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles({ graph: {
    ...topology, weightsManifest: [{ paths: ['weights.bin', 'part2.bin'], weights: [] }]
  } })), { code: 'classifier/weights-name-mismatch' });
  assert.equal(calls.files.length, 0);
});

await check('Local multi-shard import follows manifest order without any network request', async () => {
  const { api, calls } = await fresh();
  const graph = { ...topology, weightsManifest: [
    { paths:['first.bin','second.bin'], weights:[{name:'example',shape:[2],dtype:'float32'}] }
  ] };
  const files = [new File([JSON.stringify(graph)],'model.json'), new File([JSON.stringify(metadata)],'metadata.json'),
    new File([new Uint8Array([5,6,7,8])],'second.bin'), new File([new Uint8Array([1,2,3,4])],'first.bin')];
  const info = await api.loadPlantModelFromFiles(files);
  assert.equal(info.source,'files');
  assert.equal(calls.fetch.length,0);
  assert.equal(calls.files.length,0);
  assert.deepEqual([...new Uint8Array(calls.load[0].artifacts.weightData)],[1,2,3,4,5,6,7,8]);
  assert.equal((await api.classifyPlant(canvas,api.IMPORTED_MODEL_URL)).topClass,labels[0]);
  api.clearImportedPlantModel();
  assert.equal(calls.models[0].disposed,1);
});

await check('Uncertain Teachable Machine predictions remain inconclusive', async () => {
  const { api } = await fresh({model:{predict:async()=>[
    {className:labels[0],probability:0.51},{className:labels[1],probability:0.49}
  ]}});
  const result = await api.classifyPlant(canvas,api.BUNDLED_MODEL_URL);
  assert.equal(result.severity,'observe');
  assert.equal(result.title,'Análise inconclusiva');
});

await check('Metadata, healthy-class selection and hostile weight manifests are validated', async () => {
  const { api, calls } = await fresh();
  for (const meta of [{ ...metadata, labels: ['one'] }, { ...metadata, labels: ['same', 'same'] }]) {
    await assert.rejects(api.loadPlantModelFromFiles(exportedFiles({ meta })), { code: 'classifier/invalid-model' });
  }
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles({ meta: { ...metadata, packageName: '@teachablemachine/pose' } })), { code: 'classifier/wrong-model-type' });
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles({ graph: {
    ...topology, weightsManifest: [{ paths: ['../weights.bin'], weights: [] }]
  } })), { code: 'classifier/invalid-model' });
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles(), undefined, { healthyClass: 'saudável' }), error => {
    assert.equal(error.code, 'classifier/invalid-healthy-class'); assert.deepEqual(error.labels, labels); return true;
  });
  const malformed = exportedFiles(); malformed[0] = new File(['not json'], 'model.json');
  await assert.rejects(api.loadPlantModelFromFiles(malformed), { code: 'classifier/invalid-model' });
  assert.equal(calls.files.length, 0);
});

await check('Rejected replacement retains the previous imported model and healthy class context', async () => {
  const { api, calls } = await fresh();
  await api.loadPlantModelFromFiles(exportedFiles(), undefined, { healthyClass: '' });
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles(), undefined, { healthyClass: 'Unknown' }), { code: 'classifier/invalid-healthy-class' });
  assert.equal(calls.files.length, 1); assert.equal(calls.models[0].disposed, 0);
  assert.equal((await api.classifyPlant(canvas, api.IMPORTED_MODEL_URL)).topClass, labels[0]);
  api.clearImportedPlantModel();
});

await check('Both hosted and imported class validation failures dispose allocated models', async () => {
  const { api, calls } = await fresh({ model: { getTotalClasses: () => 3 } });
  await assert.rejects(api.loadPlantModel('https://teachablemachine.withgoogle.com/models/invalid/'), { code: 'classifier/invalid-model' });
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles()), { code: 'classifier/invalid-model' });
  assert.deepEqual(calls.models.map(model => model.disposed), [1, 1]);
  const mismatch = await fresh({ model: { getClassLabels: () => ['wrong', 'labels'] } });
  await assert.rejects(mismatch.api.loadPlantModelFromFiles(exportedFiles()), { code: 'classifier/invalid-model' });
  assert.equal(mismatch.calls.models[0].disposed, 1);
});

await check('Cancellation before import skips work and late models are disposed after cancellation', async () => {
  const started = deferred(), completed = deferred();
  const model = mockModel();
  const { api, calls } = await fresh({ loadFromFiles: () => { started.resolve(); return completed.promise; } });
  const before = new AbortController(); before.abort();
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles(), undefined, { signal: before.signal }), { code: 'classifier/cancelled' });
  assert.equal(calls.files.length, 0);
  const controller = new AbortController();
  const pending = api.loadPlantModelFromFiles(exportedFiles(), undefined, { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'classifier/cancelled' });
  await started.promise; controller.abort(); await rejected;
  completed.resolve(model); await tick();
  assert.equal(model.disposed, 1);
  assert.throws(() => api.validateModelURL(api.IMPORTED_MODEL_URL), { code: 'classifier/model-files-missing' });
});

await check('Clear cancels pending import and replacement releases the previous loaded model', async () => {
  let wait = false;
  const started = deferred(), completed = deferred();
  const { api, calls } = await fresh({ loadFromFiles: () => {
    if (wait) { started.resolve(); return completed.promise; }
    return mockModel();
  } });
  await api.loadPlantModelFromFiles(exportedFiles());
  await api.loadPlantModelFromFiles(exportedFiles());
  assert.equal(calls.models[0].disposed, 1); assert.equal(calls.models[1].disposed, 0);
  wait = true;
  const pending = api.loadPlantModelFromFiles(exportedFiles());
  const rejected = assert.rejects(pending, { code: 'classifier/cancelled' });
  await started.promise; api.clearImportedPlantModel(); await rejected;
  assert.equal(calls.models[1].disposed, 1);
  const late = mockModel(); completed.resolve(late); await tick(); assert.equal(late.disposed, 1);
});

await check('Abort and logout defer tensor disposal until actual pending inference finishes', async () => {
  const started = deferred(), completed = deferred();
  const model = mockModel({ predict: () => { started.resolve(); return completed.promise; } });
  const { api } = await fresh({ loadFromFiles: () => model });
  await api.loadPlantModelFromFiles(exportedFiles());
  const controller = new AbortController();
  const pending = api.classifyPlant(canvas, api.IMPORTED_MODEL_URL, undefined, { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'classifier/cancelled' });
  await started.promise; controller.abort(); await rejected;
  api.clearImportedPlantModel(); assert.equal(model.disposed, 0);
  completed.resolve(probabilities); await tick(); assert.equal(model.disposed, 1);
});

await check('Replacing an imported model during inference retires the old result safely', async () => {
  const started = deferred(), completed = deferred();
  const first = mockModel({ predict: () => { started.resolve(); return completed.promise; } });
  const second = mockModel();
  let count = 0;
  const { api } = await fresh({ loadFromFiles: () => ++count === 1 ? first : second });
  await api.loadPlantModelFromFiles(exportedFiles());
  const pending = api.classifyPlant(canvas, api.IMPORTED_MODEL_URL);
  const rejected = assert.rejects(pending, { code: 'classifier/cancelled' });
  await started.promise; await api.loadPlantModelFromFiles(exportedFiles());
  assert.equal(first.disposed, 0);
  completed.resolve(probabilities); await rejected;
  assert.equal(first.disposed, 1); assert.equal(second.disposed, 0);
  assert.equal((await api.classifyPlant(canvas, api.IMPORTED_MODEL_URL)).confidence, 0.8);
  api.clearImportedPlantModel(); assert.equal(second.disposed, 1);
});

await check('Invalid images and inconsistent predictions cannot become analysis results', async () => {
  const { api, calls } = await fresh({ model: { predict: async () => [{ className: labels[0], probability: 0.8 }, { className: labels[1], probability: 0.8 }] } });
  await assert.rejects(api.classifyPlant({ tagName: 'IMG', complete: false }, api.BUNDLED_MODEL_URL), { code: 'classifier/invalid-image' });
  assert.equal(calls.load.length, 0);
  await assert.rejects(api.classifyPlant(canvas, api.BUNDLED_MODEL_URL), { code: 'classifier/invalid-prediction' });
});

await check('A WebGL failure retries the same model and photo once on CPU', async () => {
  let attempts = 0;
  const stages = [];
  const { api, calls } = await fresh({ backend: 'webgl', model: {
    predict: async (photo, flipped) => {
      assert.equal(photo, canvas); assert.equal(flipped, false);
      if (++attempts === 1) throw new Error('WebGL context lost during prediction');
      assert.equal(globalThis.tf.getBackend(), 'cpu');
      return probabilities;
    }
  } });
  const result = await api.classifyPlant(canvas, api.BUNDLED_MODEL_URL, (_message, stage) => stages.push(stage));
  assert.equal(result.topClass, labels[0]); assert.equal(result.confidence, 0.8);
  assert.equal(attempts, 2); assert.equal(calls.load.length, 1);
  assert.deepEqual(calls.backends, ['cpu']);
  assert(stages.includes('backend-retry'));
});

await check('A CPU failure is surfaced and never loops or fabricates a result', async () => {
  let attempts = 0;
  const { api, calls } = await fresh({ backend: 'cpu', model: {
    predict: async () => { attempts += 1; throw new Error('Invalid runtime operation'); }
  } });
  await assert.rejects(api.classifyPlant(canvas, api.BUNDLED_MODEL_URL), { code: 'classifier/prediction-failed' });
  assert.equal(attempts, 1); assert.deepEqual(calls.backends, []);
});

await check('Failure on both WebGL and CPU remains an error after two attempts', async () => {
  let attempts = 0;
  const { api, calls } = await fresh({ backend: 'webgl', model: {
    predict: async () => { attempts += 1; throw new Error('Prediction unavailable'); }
  } });
  await assert.rejects(api.classifyPlant(canvas, api.BUNDLED_MODEL_URL), { code: 'classifier/prediction-failed' });
  assert.equal(attempts, 2); assert.deepEqual(calls.backends, ['cpu']);
});

await check('Cancelling while CPU initializes prevents the second prediction', async () => {
  let attempts = 0;
  const started = deferred(), completed = deferred();
  const { api, calls } = await fresh({ backend: 'webgl',
    setBackend: () => { started.resolve(); return completed.promise; },
    model: { predict: async () => { attempts += 1; throw new Error('WebGL unavailable'); } }
  });
  const controller = new AbortController();
  const pending = api.classifyPlant(canvas, api.BUNDLED_MODEL_URL, undefined, { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'classifier/cancelled' });
  await started.promise; controller.abort(); await rejected;
  completed.resolve(true); await tick();
  assert.equal(attempts, 1); assert.deepEqual(calls.backends, ['cpu']);
});

await check('A rejected CPU backend cannot be mistaken for a successful fallback', async () => {
  let attempts = 0;
  const { api, calls } = await fresh({ backend: 'webgl', setBackend: async () => false,
    model: { predict: async () => { attempts += 1; throw new Error('WebGL unavailable'); } }
  });
  await assert.rejects(api.classifyPlant(canvas, api.BUNDLED_MODEL_URL), { code: 'classifier/prediction-failed' });
  assert.equal(attempts, 1); assert.deepEqual(calls.backends, ['cpu']);
});

await check('Unavailable initialization backends report an actionable error before inference', async () => {
  const { api, calls } = await fresh({ backend: 'webgl', ready: async () => { throw new Error('No backend available'); }, setBackend: async () => false });
  await assert.rejects(api.loadPlantModel(api.BUNDLED_MODEL_URL), { code: 'classifier/backend-unavailable' });
  assert.equal(calls.load.length, 0); assert.deepEqual(calls.backends, ['cpu']);
});

await tick();
assert.deepEqual(unhandled, [], 'Cancellation must not leak unhandled promise rejections');
console.log(`${passed} classifier checks passed. Explicit library/network mocks only; no real trained model was executed.`);
