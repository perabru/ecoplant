/**
 * Local inference with the openly licensed DINOv2 PlantVillage model by
 * Rodayna Emad Mohamed (rodynaemad). EcoPlant did not train this model.
 * Model/metadata: https://huggingface.co/rodynaemad/plant-disease-dinov2-small
 * OOD centroids/preprocessing: https://huggingface.co/spaces/rodynaemad/plant-disease-scanner
 * Fixed revisions and CC BY-SA 4.0 attribution: assets/plant-ai-attribution.txt.
 * No photo is sent to a model server. There is no synthetic prediction fallback.
 */
import { describePlantHealth, describeInconclusiveReason } from './plant-health.js';

const MODEL_NAME = 'EcoPlant IA · DINOv2 PlantVillage';
const MODEL_URL = 'https://huggingface.co/rodynaemad/plant-disease-dinov2-small';
const MODEL_REVISION = '06ebf5e308e100fd000d738c42b059ebb5f58a16';
const SPACE_REVISION = 'b26e704bd72c2fe05632ea6f7be680a2eca0d8f5';
const RUNTIME_VERSION = '1.30.0';
const RUNTIME_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${RUNTIME_VERSION}/dist/`;
// This cache contains only the two fixed, public binary assets below. It never
// contains a photo, prediction, account, imported model or Firebase response.
const ASSET_CACHE_NAME = 'ecoplant-ai-verified-v1';
const LOAD_TIMEOUT = 120000;
const INFERENCE_TIMEOUT = 45000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const FEATURE_DIM = 768;
// Exact threshold and label order from the pinned author's meta.json. The
// threshold is the author's OOD calibration, not a probability of disease.
const OOD_THRESHOLD = 0.699429452419281;
const LABELS = Object.freeze([
  'Apple___Apple_scab', 'Apple___Black_rot', 'Apple___Cedar_apple_rust', 'Apple___healthy',
  'Blueberry___healthy', 'Cherry_(including_sour)___Powdery_mildew', 'Cherry_(including_sour)___healthy',
  'Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot', 'Corn_(maize)___Common_rust_',
  'Corn_(maize)___Northern_Leaf_Blight', 'Corn_(maize)___healthy', 'Grape___Black_rot',
  'Grape___Esca_(Black_Measles)', 'Grape___Leaf_blight_(Isariopsis_Leaf_Spot)', 'Grape___healthy',
  'Orange___Haunglongbing_(Citrus_greening)', 'Peach___Bacterial_spot', 'Peach___healthy',
  'Pepper,_bell___Bacterial_spot', 'Pepper,_bell___healthy', 'Potato___Early_blight',
  'Potato___Late_blight', 'Potato___healthy', 'Raspberry___healthy', 'Soybean___healthy',
  'Squash___Powdery_mildew', 'Strawberry___Leaf_scorch', 'Strawberry___healthy',
  'Tomato___Bacterial_spot', 'Tomato___Early_blight', 'Tomato___Late_blight', 'Tomato___Leaf_Mold',
  'Tomato___Septoria_leaf_spot', 'Tomato___Spider_mites Two-spotted_spider_mite', 'Tomato___Target_Spot',
  'Tomato___Tomato_Yellow_Leaf_Curl_Virus', 'Tomato___Tomato_mosaic_virus', 'Tomato___healthy'
]);
// The model predicts crop groups, not every botanical species. In particular,
// cherry, blueberry and squash labels do not identify one exact species.
const CROP_INFO = Object.freeze({
  Apple: ['Macieira', 'Malus domestica'],
  Blueberry: ['Mirtilo', 'Vaccinium spp.'],
  'Cherry_(including_sour)': ['Cerejeira', 'Prunus spp.'],
  'Corn_(maize)': ['Milho', 'Zea mays'],
  Grape: ['Videira', 'Vitis spp.'],
  Orange: ['Laranjeira', 'Citrus spp.'],
  Peach: ['Pessegueiro', 'Prunus persica'],
  'Pepper,_bell': ['Pimentão', 'Capsicum annuum'],
  Potato: ['Batateira', 'Solanum tuberosum'],
  Raspberry: ['Framboeseira', 'Rubus spp.'],
  Soybean: ['Soja', 'Glycine max'],
  Squash: ['Abóbora', 'Cucurbita spp.'],
  Strawberry: ['Morangueiro', 'Fragaria spp.'],
  Tomato: ['Tomateiro', 'Solanum lycopersicum']
});
const SPECIES_PREFIX = 'Espécie provável: ';
const SPECIES_UNKNOWN = 'Espécie não identificada';
// Application display policy, not calibrated botanical-identification accuracy.
const SPECIES_MIN_CONFIDENCE = 0.75;
const SPECIES_MIN_MARGIN = 0.15;
const ASSETS = Object.freeze([
  { name: 'model', url: `${MODEL_URL}/resolve/${MODEL_REVISION}/onnx/model_with_features_quantized.onnx`, bytes: 24231170, sha256: '907fe4ed9d5f3fa6f6f6a9321a4564766e5136a2f316a2b23c930c3bfa13d72b' },
  { name: 'centroids', url: `https://huggingface.co/spaces/rodynaemad/plant-disease-scanner/resolve/${SPACE_REVISION}/centroids.f32`, bytes: 116736, sha256: 'e873c9330db03dddf31e1f73db8fcb0bc4a186b69ff4d944aaec703beeeb5e51' }
]);
let currentEntry;

function failure(code, message, cause) {
  const error = new Error(message);
  error.code = `plant-ai/${code}`;
  if (cause) error.cause = cause;
  return error;
}
function cancellation() {
  const error = failure('cancelled', 'Análise cancelada. Você pode tentar novamente.');
  error.name = 'AbortError';
  return error;
}
function isAppError(error) { return typeof error?.code === 'string' && error.code.startsWith('plant-ai/'); }
function reason(signal) { return isAppError(signal?.reason) ? signal.reason : cancellation(); }
function checkSignal(signal) { if (signal?.aborted) throw reason(signal); }
function announce(callback, message, stage, details) {
  try { if (typeof callback === 'function') callback(message, stage, details); } catch { /* A display callback cannot change inference. */ }
}
function announceEntry(entry, message, stage, details) {
  if (entry.retired) return;
  entry.progress = [message, stage, details];
  for (const callback of entry.listeners) announce(callback, message, stage, details);
}
function abortable(promise, signal) {
  if (signal?.aborted) return Promise.reject(reason(signal));
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(reason(signal)); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
function delay(ms, signal) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
    const abort = () => finish(reason(signal));
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function runtimeReady() { return globalThis.ort?.env?.versions?.web === RUNTIME_VERSION && Boolean(globalThis.ort?.InferenceSession?.create && globalThis.ort?.Tensor); }
function runtimeAttempt(signal) {
  checkSignal(signal);
  if (typeof document === 'undefined') throw failure('browser-required', 'Abra o EcoPlant em um navegador atualizado para analisar a foto.');
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    const abort = () => finish(reason(signal));
    const timer = setTimeout(() => finish(failure('library-unavailable', 'O carregamento da biblioteca de IA demorou demais. Confira a conexão e tente novamente.')), 30000);
    // Use the WASM-only build to avoid downloading unused WebGPU/JSEP code.
    script.src = `${RUNTIME_BASE}ort.wasm.min.js`;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => finish(runtimeReady() ? null : failure('library-unavailable', 'A biblioteca de IA não iniciou na versão esperada. Recarregue o aplicativo e tente novamente.'));
    script.onerror = () => finish(failure('library-unavailable', 'Não foi possível baixar a biblioteca de IA. Confira a conexão e os bloqueadores de conteúdo.'));
    signal.addEventListener('abort', abort, { once: true });
    document.head.appendChild(script);
  });
}
async function ensureRuntime(entry) {
  const signal = entry.controller.signal;
  for (let attempt = 0; !runtimeReady(); attempt++) {
    try { await runtimeAttempt(signal); } catch (error) {
      checkSignal(signal);
      if (attempt >= MAX_ATTEMPTS - 1 || error.code === 'plant-ai/browser-required') throw error;
      announceEntry(entry, 'Tentando baixar a biblioteca de IA novamente…', 'retry');
      await delay(350 * 2 ** attempt, signal);
    }
  }
  checkSignal(signal);
  // One WASM thread also works on static hosts without cross-origin isolation.
  const runtime = globalThis.ort;
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.wasmPaths = RUNTIME_BASE;
  return runtime;
}
function httpFailure(status) {
  const error = status === 401 || status === 403
    ? failure('model-access-denied', 'O servidor não permitiu baixar a IA. Tente novamente mais tarde ou gere um relatório de observação.')
    : RETRYABLE_STATUS.has(status)
      ? failure('model-temporarily-unavailable', `O servidor da IA está temporariamente indisponível (HTTP ${status}). Tente novamente ou gere um relatório de observação.`)
      : failure('model-unavailable', `Não foi possível baixar os arquivos da IA (HTTP ${status}). Tente novamente mais tarde ou gere um relatório de observação.`);
  error.status = status;
  return error;
}
function retryDelay(response, attempt) {
  const fallback = 400 * 2 ** attempt, value = response?.headers?.get('retry-after');
  if (!value) return fallback;
  const seconds = Number(value), requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(requested) ? Math.max(fallback, Math.min(requested, 4000)) : fallback;
}
async function readAsset(response, asset, entry, source = 'download') {
  const signal = entry.controller.signal, header = Number(response.headers?.get('content-length'));
  if (Number.isFinite(header) && header > asset.bytes) throw failure('invalid-model', 'O arquivo da IA tem tamanho inesperado. Tente recarregar o aplicativo.');
  let result;
  const progress = loaded => {
    const percent = Math.min(100, Math.floor(loaded / asset.bytes * 100));
    const message = source === 'cache'
      ? 'Verificando os arquivos da IA salvos neste dispositivo…'
      : asset.name === 'model' ? `Baixando IA: ${percent}% (${(loaded / 1000000).toFixed(1)} de 24,2 MB)…` : 'Preparando a verificação da imagem…';
    announceEntry(entry, message, source, { loaded, total: asset.bytes, percent, resource: asset.name });
  };
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    const abort = () => { Promise.resolve(reader.cancel(reason(signal))).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      while (true) {
        checkSignal(signal);
        const { done, value } = await abortable(reader.read(), signal);
        if (done) break;
        if (!(value instanceof Uint8Array)) throw failure('invalid-model', 'O download da IA retornou dados inválidos.');
        length += value.byteLength;
        if (length > asset.bytes) { await reader.cancel(); throw failure('invalid-model', 'O arquivo da IA excede o tamanho esperado.'); }
        chunks.push(value);
        progress(length);
      }
    } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
    result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  } else result = new Uint8Array(await abortable(response.arrayBuffer(), signal));
  checkSignal(signal);
  if (result.byteLength !== asset.bytes) throw failure('invalid-model', 'O download da IA está incompleto. Confira a conexão e tente novamente.');
  progress(result.byteLength);
  if (!globalThis.crypto?.subtle?.digest) throw failure('browser-required', 'Abra o EcoPlant por HTTPS em um navegador atualizado para verificar os arquivos da IA.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', result);
  checkSignal(signal);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.sha256) throw failure('invalid-model', 'A verificação dos arquivos da IA falhou. Recarregue a página e tente novamente.');
  return result;
}
async function readCachedAsset(asset, entry) {
  const signal = entry.controller.signal;
  if (!globalThis.caches?.open) return null;
  try {
    const cache = await abortable(globalThis.caches.open(ASSET_CACHE_NAME), signal);
    const response = await abortable(cache.match(asset.url), signal);
    if (!response) return null;
    try {
      // Cache entries are not trusted: the same byte count and SHA-256 checks
      // are repeated before any cached model is handed to the runtime.
      return await readAsset(response, asset, entry, 'cache');
    } catch (error) {
      checkSignal(signal);
      try { await abortable(cache.delete(asset.url), signal); } catch { checkSignal(signal); }
      return null;
    }
  } catch (error) {
    checkSignal(signal);
    // Private mode, disabled storage and quota errors must not stop inference.
    return null;
  }
}
async function rememberVerifiedAsset(asset, bytes) {
  if (!globalThis.caches?.open) return;
  try {
    // Construct the response before yielding: a runtime may subsequently take
    // ownership of the model's ArrayBuffer. Response retains its own bytes.
    const response = new Response(bytes, { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength)
    } });
    const cache = await globalThis.caches.open(ASSET_CACHE_NAME);
    await cache.put(asset.url, response);
  } catch { /* Persistence is an optional optimization, including quota failures. */ }
}
async function fetchAsset(asset, entry) {
  const signal = entry.controller.signal;
  const cached = await readCachedAsset(asset, entry);
  checkSignal(signal);
  if (cached) return cached;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    checkSignal(signal);
    let response;
    try {
      response = await fetch(asset.url, { signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw httpFailure(response.status);
      // HF serves fixed revision files through its signed CDN redirects. The
      // exact SHA-256 below verifies the artifact independently of that CDN.
      const bytes = await readAsset(response, asset, entry);
      // Saving never delays the result and its rejection is handled internally.
      void rememberVerifiedAsset(asset, bytes);
      return bytes;
    } catch (error) {
      checkSignal(signal);
      const transient = !error.code || RETRYABLE_STATUS.has(error.status);
      if (!transient || attempt === MAX_ATTEMPTS - 1) {
        if (isAppError(error)) throw error;
        throw failure('network', 'Não foi possível baixar a IA. Confira a conexão e tente novamente ou gere um relatório de observação.', error);
      }
      announceEntry(entry, 'A conexão com a IA oscilou. Tentando novamente…', 'retry');
      await delay(retryDelay(response, attempt), signal);
    }
  }
}
function validateCentroids(bytes) {
  if (bytes.byteLength !== LABELS.length * FEATURE_DIM * 4) throw failure('invalid-model', 'Os dados de verificação da IA estão incompletos.');
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  for (let i = 0; i < LABELS.length; i++) {
    let squared = 0;
    for (let j = 0; j < FEATURE_DIM; j++) { const value = values[i * FEATURE_DIM + j]; if (!Number.isFinite(value)) throw failure('invalid-model', 'Os dados de verificação da IA são inválidos.'); squared += value * value; }
    if (Math.abs(squared - 1) > 0.01) throw failure('invalid-model', 'A verificação da IA tem parâmetros inesperados.');
  }
  return values;
}
function disposeEntry(entry) {
  if (!entry.retired || entry.active || !entry.session || entry.released) return;
  entry.released = true;
  const session = entry.session;
  entry.session = null;
  entry.centroids = null;
  Promise.resolve().then(() => session.release()).catch(() => {});
}
function retireEntry(entry, error = cancellation()) {
  if (!entry) return;
  entry.retired = true;
  if (currentEntry === entry) currentEntry = undefined;
  if (!entry.controller.signal.aborted) entry.controller.abort(error);
  disposeEntry(entry);
}
function getEntry() {
  if (currentEntry && !currentEntry.retired) return currentEntry;
  const entry = { controller: new AbortController(), listeners: new Set(), waiters: 0, active: 0, retired: false, released: false, session: null, centroids: null, queue: Promise.resolve() };
  currentEntry = entry;
  entry.promise = (async () => {
    const timer = setTimeout(() => retireEntry(entry, failure('timeout', 'O carregamento da IA ultrapassou 2 minutos. Confira a conexão ou gere um relatório de observação.')), LOAD_TIMEOUT);
    try {
      announceEntry(entry, 'Preparando a IA de imagem…', 'loading');
      entry.runtime = await ensureRuntime(entry);
      const [model, centroids] = await Promise.all(ASSETS.map(asset => fetchAsset(asset, entry)));
      checkSignal(entry.controller.signal);
      entry.centroids = validateCentroids(centroids);
      announceEntry(entry, 'Iniciando a IA neste dispositivo…', 'initializing');
      // Creation cannot be forcibly cancelled; late sessions are released below.
      entry.session = await entry.runtime.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      checkSignal(entry.controller.signal);
      if (entry.session.inputNames?.length !== 1 || entry.session.inputNames[0] !== 'pixel_values' || !['logits', 'features'].every(name => entry.session.outputNames?.includes(name))) throw failure('invalid-model', 'A IA carregada não tem as entradas e saídas esperadas.');
      announceEntry(entry, 'IA pronta para analisar a folha.', 'ready');
      return entry;
    } catch (error) {
      const exposed = entry.controller.signal.aborted ? reason(entry.controller.signal) : isAppError(error) ? error : failure('library-unavailable', 'Este navegador não conseguiu iniciar a IA. Tente um navegador atualizado ou gere um relatório de observação.', error);
      retireEntry(entry, exposed);
      throw exposed;
    } finally { clearTimeout(timer); disposeEntry(entry); }
  })();
  entry.promise.catch(() => {});
  return entry;
}
async function acquire(entry, onProgress, signal) {
  checkSignal(signal);
  entry.waiters++;
  // Wrap each subscriber so a reused callback is not removed by another caller.
  const callback = (...args) => announce(onProgress, ...args);
  entry.listeners.add(callback);
  if (entry.progress) callback(...entry.progress);
  try { return await abortable(abortable(entry.promise, entry.controller.signal), signal); }
  finally {
    entry.listeners.delete(callback);
    entry.waiters--;
    if (!entry.waiters && !entry.session && !entry.retired) retireEntry(entry);
  }
}

/** Download and verify the fixed public model once per tab. */
export async function loadPlantAI(onProgress, { signal } = {}) {
  checkSignal(signal);
  const entry = await acquire(getEntry(), onProgress, signal);
  checkSignal(signal);
  checkSignal(entry.controller.signal);
  return { labels: [...LABELS], modelName: MODEL_NAME, modelURL: MODEL_URL, source: 'plant-ai', license: 'CC-BY-SA-4.0' };
}

function preprocess(image, runtime) {
  const width = image?.naturalWidth || image?.videoWidth || image?.width;
  const height = image?.naturalHeight || image?.videoHeight || image?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 100000 || height > 100000) throw failure('invalid-image', 'Escolha uma foto válida e nítida de uma única folha.');
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 224;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const scale = 256 / Math.min(width, height), scaledWidth = Math.round(width * scale), scaledHeight = Math.round(height * scale);
    context.drawImage(image, -Math.floor((scaledWidth - 224) / 2), -Math.floor((scaledHeight - 224) / 2), scaledWidth, scaledHeight);
    const pixels = context.getImageData(0, 0, 224, 224).data;
    if (pixels.length !== 224 * 224 * 4) throw new Error('Invalid pixel buffer');
    const data = new Float32Array(3 * 224 * 224), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < 224 * 224; i++) for (let channel = 0; channel < 3; channel++) data[channel * 224 * 224 + i] = (pixels[i * 4 + channel] / 255 - mean[channel]) / std[channel];
    return new runtime.Tensor('float32', data, [1, 3, 224, 224]);
  } catch (error) { throw failure('invalid-image', 'Não foi possível ler esta foto. Escolha outra imagem JPG, PNG ou WebP de uma única folha.', error); }
}
function unknownSpecies(reason) {
  return { name: SPECIES_UNKNOWN, reason };
}
function speciesPossibility(predictions) {
  // Sum every crop's measured class scores before reducing the stored disease
  // list to three. Several uncertain diseases can still identify the same crop.
  const totals = new Map(Object.keys(CROP_INFO).map(crop => [crop, 0]));
  for (const prediction of predictions) {
    const crop = prediction.className.split('___')[0];
    totals.set(crop, totals.get(crop) + prediction.probability);
  }
  const ranked = [...totals].sort((a, b) => b[1] - a[1]);
  const [crop, probability] = ranked[0];
  if (probability < SPECIES_MIN_CONFIDENCE || probability - ranked[1][1] < SPECIES_MIN_MARGIN) return unknownSpecies(
    'A IA não diferenciou a cultura com segurança suficiente. Envie uma foto nítida de uma única folha; o reconhecimento cobre apenas as 14 culturas informadas no aplicativo.'
  );
  const [name, scientificName] = CROP_INFO[crop];
  const score = (probability * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return {
    name: SPECIES_PREFIX + name,
    reason: `Referência botânica: ${scientificName}. Pontuação para a cultura: ${score}% entre as 14 culturas do modelo. ${scientificName.endsWith('spp.') ? 'Este grupo inclui várias espécies; a foto não diferencia a espécie exata. ' : ''}Identificação visual preliminar, sem confirmação botânica.`
  };
}

/** Read species feedback shared by the built-in and combined analysis flows. */
export function describePlantSpecies(result) {
  const entries = Array.isArray(result?.possibilities) ? result.possibilities : [];
  for (const entry of entries) {
    if (typeof entry?.name !== 'string' || typeof entry.reason !== 'string' || !entry.reason.trim()) continue;
    if (entry.name.startsWith(SPECIES_PREFIX)) {
      const name = entry.name.slice(SPECIES_PREFIX.length);
      if (Object.values(CROP_INFO).some(info => info[0] === name)) return { status: 'identified', name, summary: entry.reason };
    }
    if (entry.name === SPECIES_UNKNOWN) return { status: 'inconclusive', name: SPECIES_UNKNOWN, summary: entry.reason };
  }
  return {
    status: 'unassessed', name: 'Espécie não analisada',
    summary: 'Este registro não contém identificação da espécie. Faça uma nova análise com a foto da folha.'
  };
}

function outputsToResult(outputs, centroids) {
  const logits = outputs?.logits?.data, features = outputs?.features?.data;
  if (logits?.length !== LABELS.length || features?.length !== FEATURE_DIM || outputs.logits.dims?.join(',') !== '1,38' || outputs.features.dims?.join(',') !== '1,768' || !Array.from(logits).every(Number.isFinite) || !Array.from(features).every(Number.isFinite)) throw failure('inference', 'A IA retornou dados inválidos. Tente outra foto ou gere um relatório de observação.');
  const max = Math.max(...logits), exp = Array.from(logits, value => Math.exp(value - max)), sum = exp.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) throw failure('inference', 'A IA não conseguiu calcular um resultado válido para esta foto.');
  const allPredictions = exp.map((value, index) => ({ className: LABELS[index], probability: value / sum })).sort((a, b) => b.probability - a.probability);
  const predictions = allPredictions.slice(0, 3);
  const norm = Math.hypot(...features);
  let similarity = -Infinity;
  if (norm > 0) for (let i = 0; i < LABELS.length; i++) {
    let dot = 0;
    for (let j = 0; j < FEATURE_DIM; j++) dot += centroids[i * FEATURE_DIM + j] * features[j];
    similarity = Math.max(similarity, dot / norm);
  }
  const base = { method: 'plant-ai', modelName: MODEL_NAME, modelURL: MODEL_URL, modelLabels: [...LABELS], analyzedAt: new Date().toISOString(), disclaimer: 'Avaliação preliminar por modelo aberto de Rodayna Emad Mohamed (rodynaemad), licença CC BY-SA 4.0. Treinado em folhas isoladas do PlantVillage: 38 classes de 14 culturas. Fotos de campo, outras espécies e problemas ausentes do treinamento podem produzir erros. O cálculo da IA ocorre neste dispositivo. A pontuação não confirma um diagnóstico; procure orientação agronômica antes de tratar a planta.' };
  if (similarity < OOD_THRESHOLD) {
    const explanation = describeInconclusiveReason('model-compatibility');
    return {
      ...base, title: explanation.title, topClass: explanation.title, severity: 'observe',
      summary: explanation.summary, care: explanation.care,
      possibilities: [unknownSpecies('A foto não foi suficientemente compatível com as folhas das 14 culturas reconhecidas. Nenhuma espécie foi atribuída; tente uma folha inteira, centralizada e com fundo simples.')]
    };
  }
  // Reuse an existing persisted field: production Firebase rules accept these
  // name/reason entries. Do not add an unsupported field or store 38 scores.
  const identifiedBase = { ...base, possibilities: [speciesPossibility(allPredictions)] };
  const best = predictions[0];
  const measured = { ...identifiedBase, topClass: best.className, confidence: best.probability, predictions };
  const health = describePlantHealth(measured);
  // Keep inconclusive results neutral in storage as well as on screen. The
  // shared policy also interprets older saved records consistently.
  if (health.status === 'inconclusive') return {
    ...identifiedBase, title: health.title, topClass: health.title, severity: 'observe',
    summary: health.summary, care: health.care
  };
  return {
    ...measured, title: health.title,
    severity: health.status === 'healthy' ? 'observe' : 'attention',
    summary: health.summary, care: health.care
  };
}

/** Classify the supplied image/canvas locally; OOD images have no disease scores. */
export async function classifyPlantAI(image, onProgress, { signal } = {}) {
  checkSignal(signal);
  const entry = await acquire(getEntry(), onProgress, signal);
  checkSignal(signal);
  checkSignal(entry.controller.signal);
  const controller = new AbortController();
  const abortCaller = () => controller.abort(reason(signal));
  const abortEntry = () => controller.abort(reason(entry.controller.signal));
  signal?.addEventListener('abort', abortCaller, { once: true });
  entry.controller.signal.addEventListener('abort', abortEntry, { once: true });
  const timer = setTimeout(() => controller.abort(failure('timeout', 'A análise demorou demais neste dispositivo. Tente novamente ou gere um relatório de observação.')), INFERENCE_TIMEOUT);
  entry.active++;
  const work = entry.queue.then(async () => {
    checkSignal(controller.signal);
    let input, outputs;
    try {
      announce(onProgress, 'Analisando a folha neste dispositivo…', 'predicting');
      input = preprocess(image, entry.runtime);
      outputs = await entry.session.run({ pixel_values: input });
      checkSignal(controller.signal);
      const result = outputsToResult(outputs, entry.centroids);
      announce(onProgress, 'Análise concluída. Preparando o relatório…', 'complete');
      return result;
    } catch (error) {
      checkSignal(controller.signal);
      if (isAppError(error)) throw error;
      throw failure('inference', 'A IA não conseguiu analisar esta foto. Tente novamente ou gere um relatório de observação.', error);
    } finally {
      try { input?.dispose?.(); } catch { /* Keep the original result/error. */ }
      for (const tensor of Object.values(outputs || {})) { try { tensor?.dispose?.(); } catch { /* Already disposed. */ } }
    }
  }).finally(() => { entry.active--; disposeEntry(entry); });
  entry.queue = work.catch(() => {});
  try { return await abortable(work, controller.signal); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortCaller);
    entry.controller.signal.removeEventListener('abort', abortEntry);
  }
}

/** Drop the tab cache; a running inference finishes before its session is freed. */
export function clearPlantAI() { retireEntry(currentEntry); }
