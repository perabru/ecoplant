/**
 * Real inference for a published, bundled or locally imported TM IMAGE model.
 * No default model or synthetic prediction is provided.
 * Official API: googlecreativelab/teachablemachine-community/libraries/image.
 */
import { MODEL_CONFIG } from './model-config.js';

const TF_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const TM_URL = 'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js';
const LOAD_TIMEOUT = 45000;
const MAX_RESOURCE_ATTEMPTS = 3;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_WEIGHT_BYTES = 128 * 1024 * 1024;
const MIN_CLASS_CONFIDENCE = 0.75;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
export const BUNDLED_MODEL_URL = './my_model/';
export const IMPORTED_MODEL_URL = 'local:ecoplant-model';
const bundledModelURL = new URL(BUNDLED_MODEL_URL, import.meta.url).href;
const scriptLoads = new Map();
const models = new Map();
const disposedModels = new WeakSet();
let librariesPromise;
let pendingImport;

function failure(code, message, cause) {
  const error = new Error(message);
  error.code = `classifier/${code}`;
  if (cause) error.cause = cause;
  return error;
}

function cancellation() {
  const error = failure('cancelled', 'Operação cancelada. Você pode tentar novamente.');
  error.name = 'AbortError';
  return error;
}

function report(callback, message, stage) {
  if (typeof callback === 'function') {
    try { callback(message, stage); } catch { /* Display callbacks cannot break inference. */ }
  }
}

function missingModelFiles(cause) {
  return failure('model-files-missing', 'Os arquivos do modelo EcoPlant não estão disponíveis. Importe model.json, metadata.json e o arquivo de pesos .bin no Perfil, ou informe o link publicado no Teachable Machine.', cause);
}

/** Accept official TM URLs, the exact bundled folder, or an imported model in this tab. */
export function validateModelURL(value) {
  const invalid = () => failure('invalid-model-url', 'Use o modelo EcoPlant, importe os arquivos no Perfil ou cole o link HTTPS publicado no Teachable Machine, no formato https://teachablemachine.withgoogle.com/models/ID_DO_MODELO/.');
  if (typeof value !== 'string') throw invalid();
  const input = value.trim();
  if (input === BUNDLED_MODEL_URL || input === bundledModelURL) return bundledModelURL;
  if (input === IMPORTED_MODEL_URL) {
    const loaded = models.get(IMPORTED_MODEL_URL)?.loaded;
    if (!loaded || loaded.retired) throw missingModelFiles();
    return IMPORTED_MODEL_URL;
  }
  if (!input || input.length > 512 || /[%\\\s]/.test(input)) throw invalid();
  let url;
  try { url = new URL(input); } catch { throw invalid(); }
  if (url.origin !== 'https://teachablemachine.withgoogle.com' || url.username || url.password || url.search || url.hash) throw invalid();
  // Test the raw URL too: URL() otherwise silently normalizes ../ path segments.
  const match = input.match(/^https:\/\/teachablemachine\.withgoogle\.com\/models\/([A-Za-z0-9_-]{1,128})(?:\/|\/model\.json)?$/);
  if (!match) throw invalid();
  return `https://teachablemachine.withgoogle.com/models/${match[1]}/`;
}

function loadScript(url, isReady) {
  if (isReady()) return Promise.resolve();
  if (scriptLoads.has(url)) return scriptLoads.get(url);
  const pending = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(failure('browser-required', 'Abra o aplicativo em um navegador para carregar o modelo.'));
      return;
    }
    const script = document.createElement('script');
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve();
    };
    const timer = setTimeout(() => finish(failure('timeout', 'O carregamento demorou mais de 45 segundos. Confira sua conexão e tente novamente.')), LOAD_TIMEOUT);
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.src = url;
    script.onload = () => finish(isReady() ? null : failure('library-unavailable', 'A biblioteca de identificação não iniciou. Recarregue a página e tente novamente.'));
    script.onerror = () => finish(failure('library-unavailable', 'Não foi possível baixar a biblioteca de identificação. Confira a internet ou um bloqueador de conteúdo.'));
    document.head.appendChild(script);
  });
  scriptLoads.set(url, pending);
  pending.catch(() => { if (scriptLoads.get(url) === pending) scriptLoads.delete(url); });
  return pending;
}

async function ensureLibraries() {
  if (!librariesPromise) {
    librariesPromise = (async () => {
      await loadScript(TF_URL, () => Boolean(globalThis.tf?.loadLayersModel && globalThis.tf?.io?.fromMemory));
      await loadScript(TM_URL, () => Boolean(globalThis.tmImage?.CustomMobileNet && globalThis.tmImage?.loadFromFiles));
      try {
        await globalThis.tf.ready();
      } catch {
        // TensorFlow CPU is slower but works on devices without a usable WebGL context.
        try {
          await globalThis.tf.setBackend('cpu');
          await globalThis.tf.ready();
        } catch (error) {
          throw failure('backend-unavailable', 'Este navegador não conseguiu iniciar o processamento da imagem. Tente uma versão atualizada do Safari ou Chrome.', error);
        }
      }
    })();
    librariesPromise.catch(() => { librariesPromise = undefined; });
  }
  return librariesPromise;
}

function officialStorageURL(url, source) {
  if (source !== 'hosted') return null;
  const parsed = new URL(url);
  if (parsed.origin !== 'https://teachablemachine.withgoogle.com') return null;
  const path = parsed.pathname.match(/^\/models\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_.-]+)$/);
  return path ? `https://storage.googleapis.com/tm-model/${path[1]}/${path[2]}` : null;
}

function validateResourceDestination(url, response, source) {
  if (!response.url || response.url === url || response.url === officialStorageURL(url, source)) return;
  throw failure('invalid-model', 'O arquivo do modelo redirecionou para um endereço inesperado. Confira o link publicado no Teachable Machine.');
}

function resourceError(status, label, source) {
  let error;
  if (status === 404) {
    error = source === 'bundled' ? missingModelFiles() : failure('model-unavailable', 'Modelo ou arquivo não encontrado. Exporte como TensorFlow.js, publique no Teachable Machine e confira o link.');
  } else if (status === 401 || status === 403) {
    error = failure('model-access-denied', 'O servidor não permitiu acessar este modelo. Confira se o link foi publicado ou importe os arquivos no Perfil.');
  } else if (RETRYABLE_STATUS.has(status)) {
    error = failure('model-temporarily-unavailable', `O servidor do modelo está temporariamente indisponível (HTTP ${status}). Tente novamente em alguns instantes ou importe os arquivos no Perfil.`);
  } else {
    error = failure('model-unavailable', `Não foi possível acessar o arquivo ${label} (HTTP ${status}). Confira o link ou importe os arquivos no Perfil.`);
  }
  error.status = status;
  error.resource = label;
  return error;
}

function retryDelay(response, attempt) {
  const fallback = 350 * (2 ** attempt);
  const value = response?.headers?.get('Retry-After');
  if (!value) return fallback;
  const seconds = Number(value);
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(requested) ? Math.min(4000, Math.max(fallback, requested)) : fallback;
}

function waitForRetry(delay, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || cancellation());
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(signal.reason || cancellation());
    const timer = setTimeout(() => finish(), delay);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** One bounded retry policy for metadata, topology and every weights shard. */
async function fetchModelResource(url, signal, label, source, kind, announce) {
  let target = url;
  const storageURL = officialStorageURL(url, source);
  for (let attempt = 0; attempt < MAX_RESOURCE_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw signal.reason || cancellation();
    let response;
    let error;
    let retry = false;
    let useStorage = false;
    try {
      response = await abortable(fetch(target, {
        signal, mode: 'cors', credentials: 'omit', cache: 'no-cache', redirect: 'follow'
      }), signal);
      validateResourceDestination(url, response, source);
      if (!response.ok) {
        error = resourceError(response.status, label, source);
        retry = RETRYABLE_STATUS.has(response.status);
        // The mirror is the exact public destination of official TM redirects.
        // Never change endpoint to work around denied access, a missing file or 429.
        useStorage = response.status >= 500 && response.status <= 599;
      } else {
        const limit = kind === 'json' ? MAX_JSON_BYTES : MAX_WEIGHT_BYTES;
        if (Number(response.headers.get('Content-Length')) > limit) throw failure('invalid-model', `O arquivo ${label} excede o tamanho permitido para este modelo.`);
        if (kind === 'json') {
          const text = await abortable(response.text(), signal);
          if (new TextEncoder().encode(text).byteLength > limit) throw failure('invalid-model', `O arquivo ${label} é maior que o esperado para um modelo de imagem.`);
          try { return JSON.parse(text); } catch (cause) {
            throw failure('invalid-model', `O arquivo ${label} não contém JSON válido. Exporte novamente como TensorFlow.js.`, cause);
          }
        }
        const data = await abortable(response.arrayBuffer(), signal);
        if (!data.byteLength || data.byteLength > limit) throw failure('invalid-model', `O arquivo de pesos ${label} está vazio ou excede o tamanho permitido.`);
        return data;
      }
    } catch (cause) {
      if (signal.aborted) throw signal.reason || cancellation();
      if (cause?.code?.startsWith('classifier/')) throw cause;
      error = failure('network', `Não foi possível transferir ${label}. Confira sua conexão, tente novamente ou importe os arquivos no Perfil.`, cause);
      error.resource = label;
      retry = true;
      useStorage = true;
    }
    if (!retry || attempt === MAX_RESOURCE_ATTEMPTS - 1) throw error;
    if (storageURL && useStorage) target = storageURL;
    report(announce, `Tentando carregar ${label} novamente (${attempt + 2}/${MAX_RESOURCE_ATTEMPTS})…`, 'retrying');
    await waitForRetry(retryDelay(response, attempt), signal);
  }
}

function validateMetadata(metadata, topology) {
  if (!metadata || !Array.isArray(metadata.labels) || metadata.labels.length < 2 || metadata.labels.length > 200
      || metadata.labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 200)) {
    throw failure('invalid-model', 'Os rótulos do modelo não são válidos. Use um projeto de imagem com pelo menos duas classes.');
  }
  if (new Set(metadata.labels.map(label => label.trim())).size !== metadata.labels.length) {
    throw failure('invalid-model', 'Existem classes com o mesmo nome. Dê um nome diferente a cada classe e publique novamente.');
  }
  if (metadata.packageName && metadata.packageName !== '@teachablemachine/image') {
    throw failure('wrong-model-type', 'Este link não é de um modelo de imagem. Exporte um projeto de imagem do Teachable Machine.');
  }
  if (!topology || !topology.modelTopology || !Array.isArray(topology.weightsManifest) || !topology.weightsManifest.length) {
    throw failure('invalid-model', 'O modelo de imagem está incompleto. Exporte e publique novamente como TensorFlow.js.');
  }
  // Only published model-local shards: never follow arbitrary weight URLs.
  const paths = new Set();
  for (const group of topology.weightsManifest) {
    if (!group || !Array.isArray(group.paths) || !group.paths.length || !Array.isArray(group.weights) || group.paths.some(path =>
      typeof path !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(path) || path === '.' || path === '..')) {
      throw failure('invalid-model', 'O modelo contém caminhos de pesos incompatíveis. Publique o projeto diretamente pelo Teachable Machine.');
    }
    for (const path of group.paths) {
      if (paths.has(path)) throw failure('invalid-model', 'O manifesto repete um arquivo de pesos. Exporte o modelo novamente.');
      paths.add(path);
    }
  }
  return [...metadata.labels];
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || cancellation());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || cancellation());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function disposeModel(model) {
  if (!model || (typeof model !== 'object' && typeof model !== 'function') || disposedModels.has(model)) return;
  disposedModels.add(model);
  // TM's wrapper dispose() may reference an uninitialized truncatedModel.
  try { model.model?.dispose?.(); } catch { /* Runtime may have disposed it already. */ }
}

function disposeWhenIdle(loaded) {
  if (loaded.retired && loaded.inFlight === 0) disposeModel(loaded.model);
}

function retireModel(loaded) {
  if (!loaded) return;
  loaded.retired = true;
  disposeWhenIdle(loaded);
}

async function verifyLoadedModel(modelPromise, entry, labels, metadata, modelURL, source) {
  // The TM API cannot abort a weight download. Late models must still be released.
  const pending = Promise.resolve(modelPromise);
  pending.then(model => {
    if (entry.controller.signal.aborted) disposeModel(model);
  }, () => {});
  let model;
  try {
    model = await abortable(pending, entry.controller.signal);
    if (entry.controller.signal.aborted) throw entry.controller.signal.reason || cancellation();
    if (model.getTotalClasses() !== labels.length) throw failure('invalid-model', 'O número de classes difere dos rótulos. Exporte o modelo novamente.');
    const actualLabels = typeof model.getClassLabels === 'function' ? model.getClassLabels() : labels;
    if (!Array.isArray(actualLabels) || actualLabels.length !== labels.length || actualLabels.some((label, i) => String(label) !== labels[i])) {
      throw failure('invalid-model', 'As classes do modelo não correspondem aos metadados. Exporte o modelo novamente.');
    }
    return { model, labels, metadata, modelURL, source, inFlight: 0, retired: false };
  } catch (error) {
    // Includes validation failures after the underlying model allocated tensors.
    disposeModel(model);
    throw error;
  }
}

function publicModelInfo(loaded) {
  return {
    labels: [...loaded.labels],
    metadata: { ...loaded.metadata, labels: [...loaded.labels] },
    modelURL: loaded.modelURL,
    source: loaded.source
  };
}

async function loadDownloadedModel(baseURL, topology, metadata, signal, source, announce) {
  const weightSpecs = [];
  const buffers = [];
  let totalBytes = 0;
  for (const group of topology.weightsManifest) {
    weightSpecs.push(...group.weights);
    for (const path of group.paths) {
      const buffer = await fetchModelResource(`${baseURL}${path}`, signal, path, source, 'weights', announce);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_WEIGHT_BYTES) throw failure('invalid-model', 'Os pesos do modelo excedem o limite de 128 MB. Exporte um modelo menor.');
      buffers.push(buffer);
    }
  }
  if (signal.aborted) throw signal.reason || cancellation();
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buffer of buffers) {
    bytes.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  const artifacts = {
    modelTopology: topology.modelTopology,
    weightSpecs, weightData: bytes.buffer,
    format: topology.format, generatedBy: topology.generatedBy, convertedBy: topology.convertedBy
  };
  if (topology.trainingConfig) artifacts.trainingConfig = topology.trainingConfig;
  if (topology.userDefinedMetadata) artifacts.userDefinedMetadata = topology.userDefinedMetadata;
  // Use only the JSON and shard bytes already validated above: no second fetch.
  return constructModel(artifacts, metadata, signal);
}

async function constructModel(artifacts, metadata, signal) {
  const layers = await globalThis.tf.loadLayersModel(globalThis.tf.io.fromMemory(artifacts), { strict: true });
  try {
    if (signal.aborted) throw signal.reason || cancellation();
    return new globalThis.tmImage.CustomMobileNet(layers, metadata);
  } catch (error) {
    try { layers.dispose(); } catch { /* Failed construction must release weights. */ }
    throw error;
  }
}

function createEntry(baseURL, callback) {
  const source = baseURL === bundledModelURL ? 'bundled' : 'hosted';
  const controller = new AbortController();
  const entry = { controller, listeners: new Set(), promise: null, loaded: null };
  if (typeof callback === 'function') entry.listeners.add(callback);
  const announce = (message, stage) => entry.listeners.forEach(listener => report(listener, message, stage));
  const timer = setTimeout(() => controller.abort(failure('timeout', 'O modelo demorou mais de 45 segundos para carregar. Confira a internet e tente novamente.')), LOAD_TIMEOUT);
  entry.promise = (async () => {
    try {
      announce(source === 'bundled' ? 'Conferindo o modelo EcoPlant…' : 'Conferindo o modelo publicado…', 'checking');
      const [metadata, topology] = await Promise.all([
        fetchModelResource(`${baseURL}metadata.json`, controller.signal, 'metadata.json', source, 'json', announce),
        fetchModelResource(`${baseURL}model.json`, controller.signal, 'model.json', source, 'json', announce)
      ]);
      const labels = validateMetadata(metadata, topology);
      announce('Preparando o processamento da imagem…', 'libraries');
      await abortable(ensureLibraries(), controller.signal);
      announce('Baixando os pesos do seu modelo…', 'weights');
      entry.loaded = await verifyLoadedModel(loadDownloadedModel(baseURL, topology, metadata, controller.signal, source, announce), entry, labels, metadata, baseURL, source);
      announce('Modelo pronto para identificar.', 'ready');
      return entry.loaded;
    } catch (error) {
      if (models.get(baseURL) === entry) models.delete(baseURL);
      if (controller.signal.aborted) throw controller.signal.reason || cancellation();
      controller.abort(error); // Stop sibling JSON transfers and any retry delay.
      if (error?.code?.startsWith('classifier/')) throw error;
      throw failure('model-load-failed', 'Não foi possível carregar este modelo de imagem. Confira se ele foi exportado como TensorFlow.js e tente novamente.', error);
    } finally {
      clearTimeout(timer);
      entry.listeners.clear();
    }
  })();
  // Cancellation must not create an unhandled rejection if the UI already left the screen.
  entry.promise.catch(() => {});
  models.set(baseURL, entry);
  return entry;
}

async function getEntry(baseURL, callback, signal) {
  if (signal?.aborted) throw cancellation();
  if (baseURL === bundledModelURL && MODEL_CONFIG.bundledModelAvailable !== true) {
    throw failure('model-not-configured', 'O modelo EcoPlant ainda não foi adicionado ao aplicativo. Importe model.json, metadata.json e o arquivo de pesos .bin no Perfil, ou informe o link do seu modelo publicado no Teachable Machine.');
  }
  let entry = models.get(baseURL);
  if (!entry && baseURL === IMPORTED_MODEL_URL) throw missingModelFiles();
  if (!entry) entry = createEntry(baseURL, callback);
  else if (entry.loaded) report(callback, 'Modelo pronto para identificar.', 'ready');
  else if (typeof callback === 'function') entry.listeners.add(callback);
  const onAbort = () => { if (!entry.loaded) entry.controller.abort(cancellation()); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    const loaded = await entry.promise;
    if (signal?.aborted || loaded.retired) throw cancellation();
    return loaded;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    entry.listeners.delete(callback);
  }
}

/** onProgress(message, stage). Optional third argument: { signal: AbortSignal }. */
export async function loadPlantModel(baseUrl, onProgress, options = {}) {
  const modelURL = validateModelURL(baseUrl);
  return publicModelInfo(await getEntry(modelURL, onProgress, options.signal));
}

async function readModelFile(file, signal) {
  if (file.size > 8 * 1024 * 1024) throw failure('invalid-model', `O arquivo ${file.name} é maior que o esperado para um modelo de imagem.`);
  try { return JSON.parse(await abortable(file.text(), signal)); } catch (error) {
    if (signal.aborted) throw signal.reason || cancellation();
    throw failure('invalid-model', `O arquivo ${file.name} não contém JSON válido. Exporte novamente no formato TensorFlow.js.`, error);
  }
}

function selectModelFiles(files) {
  let list;
  try { list = typeof files === 'string' ? [] : Array.from(files || []); } catch { list = []; }
  if (list.some(file => !file || typeof file.name !== 'string' || typeof file.text !== 'function' || !Number.isFinite(file.size))) {
    throw failure('invalid-model-files', 'Selecione os arquivos exportados pelo Teachable Machine: model.json, metadata.json e o arquivo de pesos .bin.');
  }
  const modelFiles = list.filter(file => file.name === 'model.json');
  const metadataFiles = list.filter(file => file.name === 'metadata.json');
  const weightFiles = list.filter(file => /\.bin$/i.test(file.name));
  if (modelFiles.length > 1 || metadataFiles.length > 1) throw failure('invalid-model-files', 'Selecione apenas um model.json e um metadata.json da mesma exportação.');
  if (modelFiles.length !== 1 || metadataFiles.length !== 1 || !weightFiles.length) throw missingModelFiles();
  if (weightFiles.length > 32 || new Set(weightFiles.map(file => file.name)).size !== weightFiles.length) {
    throw failure('invalid-model-files', 'Selecione no máximo 32 arquivos de pesos, sem repetir nomes, da mesma exportação.');
  }
  if (weightFiles.some(file => file.size <= 0 || typeof file.arrayBuffer !== 'function')
      || weightFiles.reduce((sum, file) => sum + file.size, 0) > MAX_WEIGHT_BYTES) {
    throw failure('invalid-model-files', 'Os pesos precisam estar completos e somar no máximo 128 MB. Exporte novamente o modelo.');
  }
  return { modelFile: modelFiles[0], metadataFile: metadataFiles[0], weightFiles };
}

async function loadLocalShards(topology, metadata, files, signal) {
  const byName = new Map(files.map(file => [file.name, file]));
  const buffers = [];
  const weightSpecs = [];
  let total = 0;
  for (const group of topology.weightsManifest) {
    weightSpecs.push(...group.weights);
    for (const path of group.paths) {
      const buffer = await abortable(byName.get(path).arrayBuffer(), signal);
      total += buffer.byteLength;
      if (total > MAX_WEIGHT_BYTES) throw failure('invalid-model-files', 'Os pesos excedem o limite de 128 MB.');
      buffers.push(buffer);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const buffer of buffers) { bytes.set(new Uint8Array(buffer), offset); offset += buffer.byteLength; }
  return constructModel({ modelTopology: topology.modelTopology, weightSpecs, weightData: bytes.buffer,
    format: topology.format, generatedBy: topology.generatedBy, convertedBy: topology.convertedBy,
    ...(topology.trainingConfig ? {trainingConfig:topology.trainingConfig} : {}),
    ...(topology.userDefinedMetadata ? {userDefinedMetadata:topology.userDefinedMetadata} : {})
  }, metadata, signal);
}

/** Import only into this tab's memory. No upload or browser persistence is performed. */
export async function loadPlantModelFromFiles(files, onProgress, options = {}) {
  if (options.signal?.aborted) throw cancellation();
  const { modelFile, metadataFile, weightFiles } = selectModelFiles(files);
  pendingImport?.controller.abort(cancellation());
  const controller = new AbortController();
  const entry = { controller, listeners: new Set(), promise: null, loaded: null };
  pendingImport = entry;
  const onAbort = () => controller.abort(cancellation());
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(failure('timeout', 'O modelo demorou mais de 45 segundos para carregar. Confira os arquivos e tente novamente.')), LOAD_TIMEOUT);
  entry.promise = (async () => {
    try {
      report(onProgress, 'Conferindo os arquivos do modelo…', 'checking');
      const [topology, metadata] = await Promise.all([
        readModelFile(modelFile, controller.signal), readModelFile(metadataFile, controller.signal)
      ]);
      const labels = validateMetadata(metadata, topology);
      if (typeof options.healthyClass === 'string' && options.healthyClass.trim() && !labels.includes(options.healthyClass)) {
        const error = failure('invalid-healthy-class', `A classe saudável deve corresponder exatamente a uma classe do modelo. Classes disponíveis: ${labels.join(' · ')}.`);
        error.labels = [...labels];
        throw error;
      }
      const paths = topology.weightsManifest.flatMap(group => group.paths);
      const suppliedNames = new Set(weightFiles.map(file => file.name));
      const missing = paths.filter(path => !suppliedNames.has(path));
      if (missing.length) throw failure('weights-name-mismatch', `Faltam arquivos esperados pelo model.json: ${missing.join(', ')}. Selecione todos os pesos da mesma exportação, sem renomeá-los.`);
      if (weightFiles.some(file => !paths.includes(file.name))) throw failure('unexpected-weight-files', 'Há arquivos de pesos que não pertencem a este model.json. Selecione somente os arquivos da mesma exportação.');
      report(onProgress, 'Preparando o processamento da imagem…', 'libraries');
      await abortable(ensureLibraries(), controller.signal);
      if (typeof globalThis.tmImage.loadFromFiles !== 'function') throw failure('library-unavailable', 'A biblioteca de importação não iniciou. Recarregue a página e tente novamente.');
      report(onProgress, 'Carregando os pesos do seu modelo…', 'weights');
      const modelPromise = paths.length === 1
        ? globalThis.tmImage.loadFromFiles(modelFile, weightFiles[0], metadataFile)
        : loadLocalShards(topology, metadata, weightFiles, controller.signal);
      entry.loaded = await verifyLoadedModel(modelPromise, entry, labels, metadata, IMPORTED_MODEL_URL, 'files');
      if (controller.signal.aborted || pendingImport !== entry) {
        retireModel(entry.loaded);
        throw controller.signal.reason || cancellation();
      }
      const previous = models.get(IMPORTED_MODEL_URL);
      models.set(IMPORTED_MODEL_URL, entry);
      retireModel(previous?.loaded);
      report(onProgress, 'Modelo importado e pronto para identificar nesta aba.', 'ready');
      return entry.loaded;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason || cancellation();
      if (error?.code?.startsWith('classifier/')) throw error;
      throw failure('model-load-failed', 'Não foi possível carregar estes arquivos. Use model.json, metadata.json e os pesos .bin da mesma exportação TensorFlow.js.', error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (pendingImport === entry) pendingImport = undefined;
    }
  })();
  entry.promise.catch(() => {});
  const loaded = await entry.promise;
  if (loaded.retired) throw cancellation();
  return publicModelInfo(loaded);
}

/** Forget the local import; outstanding inference releases its tensors when it finishes. */
export function clearImportedPlantModel() {
  pendingImport?.controller.abort(cancellation());
  pendingImport = undefined;
  const entry = models.get(IMPORTED_MODEL_URL);
  models.delete(IMPORTED_MODEL_URL);
  retireModel(entry?.loaded);
}

/** Optional explicit cancellation for a screen's cancel button. Loaded models stay reusable. */
export function cancelPlantModelLoad(baseUrl) {
  const modelURL = validateModelURL(baseUrl);
  const entry = models.get(modelURL);
  if (entry && !entry.loaded) entry.controller.abort(cancellation());
}

function validImageSource(source) {
  // Do not accept a URL: the caller supplies its already loaded local photo/canvas.
  if (!source || typeof source === 'string') return false;
  const tag = String(source.tagName || '').toUpperCase();
  if (tag === 'IMG') return source.complete && source.naturalWidth > 0 && source.naturalHeight > 0;
  if (tag === 'CANVAS') return source.width > 0 && source.height > 0;
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return source.width > 0 && source.height > 0;
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) return source.width > 0 && source.height > 0;
  return false;
}

/** Run actual model.predict(). Probabilities are model outputs, not diagnostic certainty. */
export async function classifyPlant(imageOrCanvas, baseUrl, onProgress, options = {}) {
  const modelURL = validateModelURL(baseUrl);
  if (!validImageSource(imageOrCanvas)) throw failure('invalid-image', 'A foto ainda não está pronta. Selecione uma imagem nítida ou fotografe novamente.');
  if (options.signal?.aborted) throw cancellation();
  const loaded = await getEntry(modelURL, onProgress, options.signal);
  const { model, labels, metadata } = loaded;
  if (options.signal?.aborted || loaded.retired) throw cancellation();
  report(onProgress, 'Analisando a foto com o seu modelo…', 'predicting');
  if (options.signal?.aborted || loaded.retired) throw cancellation();
  let raw;
  try {
    loaded.inFlight += 1;
    const release = () => { loaded.inFlight -= 1; disposeWhenIdle(loaded); };
    let prediction;
    try {
      prediction = Promise.resolve(model.predict(imageOrCanvas, false));
    } catch (error) {
      release();
      throw error;
    }
    // Release only after actual prediction completion, even if the caller aborts early.
    prediction = prediction.then(value => { release(); return value; }, error => { release(); throw error; });
    raw = options.signal ? await abortable(prediction, options.signal) : await prediction;
    if (loaded.retired) throw cancellation();
  } catch (error) {
    if (options.signal?.aborted || error?.name === 'AbortError') throw cancellation();
    throw failure('prediction-failed', 'Não foi possível processar esta foto. Tente uma nova imagem ou reinicie o aplicativo.', error);
  }
  if (!Array.isArray(raw) || raw.length !== labels.length
      || raw.some(item => !item || !labels.includes(item.className) || !Number.isFinite(item.probability) || item.probability < 0 || item.probability > 1)) {
    throw failure('invalid-prediction', 'O modelo retornou uma resposta inválida. Publique-o novamente e confira as classes.');
  }
  const total = raw.reduce((sum, item) => sum + item.probability, 0);
  if (total < 0.98 || total > 1.02 || new Set(raw.map(item => item.className)).size !== labels.length) {
    throw failure('invalid-prediction', 'O modelo retornou probabilidades inconsistentes. Confira o treinamento e publique novamente.');
  }
  const predictions = raw.map(item => ({ className: item.className, probability: item.probability }))
    .sort((a, b) => b.probability - a.probability).slice(0, 3);
  report(onProgress, 'Análise concluída.', 'complete');
  return {
    method: 'teachable-machine', modelURL,
    modelName: typeof metadata.modelName === 'string' ? metadata.modelName : 'Modelo Teachable Machine',
    modelLabels: [...labels], predictions,
    topClass: predictions[0].className,
    confidence: predictions[0].probability,
    // Keep the existing Firebase enum: uncertainty is captured in the title.
    ...(predictions[0].probability < MIN_CLASS_CONFIDENCE ? {severity:'observe',title:'Análise inconclusiva'} : {}),
    analyzedAt: new Date().toISOString()
  };
}
