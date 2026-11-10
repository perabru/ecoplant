import assert from 'node:assert/strict';
import { File } from 'node:buffer';

// Contract/lifecycle tests with explicit TM and network mocks. No trained weights
// are executed here; model accuracy requires the real EcoPlant export.
const moduleURL = new URL('../dist/classifier.js', import.meta.url);
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

async function fresh(options = {}) {
  const calls = { fetch: [], load: [], files: [], models: [] };
  globalThis.tf = { loadLayersModel() {}, ready: async () => {}, setBackend: async () => {} };
  globalThis.tmImage = {
    async load(url, meta) {
      calls.load.push({ url, metadata: meta });
      const model = options.load ? await options.load(url, meta) : mockModel(options.model);
      calls.models.push(model);
      return model;
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
    return {
      ok: true, status: 200, url: options.redirect ? options.redirect(url) : url,
      headers: { get: () => '100' },
      json: async () => structuredClone(url.endsWith('/metadata.json') ? (options.metadata || metadata) : (options.topology || topology))
    };
  };
  const api = await import(`${moduleURL.href}?case=${++instance}`);
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
  assert.deepEqual(calls.fetch.map(call => call.url).sort(), [bundledURL + 'metadata.json', bundledURL + 'model.json'].sort());
  info.labels[0] = 'changed'; info.metadata.labels[1] = 'changed';
  const result = await api.classifyPlant(canvas, api.BUNDLED_MODEL_URL);
  assert.equal(result.method, 'teachable-machine');
  assert.equal(result.topClass, labels[0]);
  assert.equal(result.confidence, 0.8);
  assert.deepEqual(result.modelLabels, labels);
  assert.equal(calls.load.length, 1);
  assert(!('source' in result), 'Firebase result schema must not acquire an unapproved property');
});

await check('Missing bundled files produce actionable import/link instructions and permit retry', async () => {
  let missing = true;
  const { api, calls } = await fresh({ fetch: async url => ({
    ok: !missing, status: missing ? 404 : 200, url, headers: { get: () => '100' },
    json: async () => url.endsWith('metadata.json') ? structuredClone(metadata) : structuredClone(topology)
  }) });
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

await check('Missing, duplicate, mismatched and multi-shard imports fail before library loading', async () => {
  const { api, calls } = await fresh();
  const files = exportedFiles();
  await assert.rejects(api.loadPlantModelFromFiles(files.slice(0, 2)), { code: 'classifier/model-files-missing' });
  await assert.rejects(api.loadPlantModelFromFiles([...files, files[0]]), { code: 'classifier/invalid-model-files' });
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles({ weightName: 'renamed.bin' })), { code: 'classifier/weights-name-mismatch' });
  await assert.rejects(api.loadPlantModelFromFiles([...files, new File(['mock'], 'other.bin')]), { code: 'classifier/multiple-weight-files' });
  await assert.rejects(api.loadPlantModelFromFiles(exportedFiles({ graph: {
    ...topology, weightsManifest: [{ paths: ['weights.bin', 'part2.bin'], weights: [] }]
  } })), { code: 'classifier/multiple-weight-files' });
  assert.equal(calls.files.length, 0);
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

await tick();
assert.deepEqual(unhandled, [], 'Cancellation must not leak unhandled promise rejections');
console.log(`${passed} classifier checks passed. Explicit library/network mocks only; no real trained model was executed.`);
