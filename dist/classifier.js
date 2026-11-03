/**
 * Real inference for a user's published Teachable Machine IMAGE model.
 * No default model or synthetic prediction is provided.
 * Official API: googlecreativelab/teachablemachine-community/libraries/image.
 */
const TF_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const TM_URL = 'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js';
const LOAD_TIMEOUT = 45000;
const scriptLoads = new Map();
const models = new Map();
let librariesPromise;

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

/** Accept only a published official TM model folder or its model.json URL. */
export function validateModelURL(value) {
  const invalid = () => failure('invalid-model-url', 'Cole o link HTTPS do modelo publicado no Teachable Machine, no formato https://teachablemachine.withgoogle.com/models/ID_DO_MODELO/.');
  if (typeof value !== 'string') throw invalid();
  const input = value.trim();
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
      await loadScript(TF_URL, () => Boolean(globalThis.tf?.loadLayersModel));
      await loadScript(TM_URL, () => Boolean(globalThis.tmImage?.load));
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

async function readJSON(url, signal, label) {
  let response;
  try {
    // Published TM URLs legitimately redirect to storage.googleapis.com/tm-model/….
    response = await fetch(url, { signal, mode: 'cors', credentials: 'omit', cache: 'no-cache', redirect: 'follow' });
  } catch (error) {
    if (signal.aborted) throw signal.reason || cancellation();
    throw failure('network', `Não foi possível acessar ${label}. Confira sua conexão e se o modelo foi publicado.`, error);
  }
  if (!response.ok) {
    throw failure('model-unavailable', response.status === 404
      ? 'Modelo não encontrado. Exporte como TensorFlow.js, publique no Teachable Machine e confira o link.'
      : `O servidor do modelo respondeu com erro ${response.status}. Tente novamente mais tarde.`);
  }
  if (response.url) {
    const requested = new URL(url);
    const delivered = new URL(response.url);
    const canonicalPath = requested.pathname.replace(/^\/models\//, '/tm-model/');
    if (delivered.href !== requested.href && !(delivered.origin === 'https://storage.googleapis.com'
      && delivered.pathname === canonicalPath && !delivered.search && !delivered.hash)) {
      throw failure('invalid-model', 'O link do modelo redirecionou para um endereço inesperado. Publique novamente pelo Teachable Machine.');
    }
  }
  const size = Number(response.headers.get('Content-Length'));
  if (size > 8 * 1024 * 1024) throw failure('invalid-model', `O arquivo ${label} é maior que o esperado para um modelo de imagem.`);
  try { return await response.json(); } catch (error) {
    if (signal.aborted) throw signal.reason || cancellation();
    throw failure('invalid-model', `O arquivo ${label} não contém um modelo válido. Publique novamente como TensorFlow.js.`, error);
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
  for (const group of topology.weightsManifest) {
    if (!Array.isArray(group.paths) || !group.paths.length || group.paths.some(path =>
      typeof path !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(path) || path === '.' || path === '..')) {
      throw failure('invalid-model', 'O modelo contém caminhos de pesos incompatíveis. Publique o projeto diretamente pelo Teachable Machine.');
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

function createEntry(baseURL, callback) {
  const controller = new AbortController();
  const entry = { controller, listeners: new Set(), promise: null, loaded: null };
  if (typeof callback === 'function') entry.listeners.add(callback);
  const announce = (message, stage) => entry.listeners.forEach(listener => report(listener, message, stage));
  const timer = setTimeout(() => controller.abort(failure('timeout', 'O modelo demorou mais de 45 segundos para carregar. Confira a internet e tente novamente.')), LOAD_TIMEOUT);
  entry.promise = (async () => {
    try {
      announce('Conferindo o modelo publicado…', 'checking');
      const [metadata, topology] = await Promise.all([
        readJSON(`${baseURL}metadata.json`, controller.signal, 'metadata.json'),
        readJSON(`${baseURL}model.json`, controller.signal, 'model.json')
      ]);
      const labels = validateMetadata(metadata, topology);
      announce('Preparando o processamento da imagem…', 'libraries');
      await abortable(ensureLibraries(), controller.signal);
      announce('Baixando os pesos do seu modelo…', 'weights');
      const modelPromise = globalThis.tmImage.load(`${baseURL}model.json`, metadata);
      // tmImage.load does not expose AbortSignal. Dispose late results after cancellation.
      modelPromise.then(lateModel => {
        if (controller.signal.aborted) {
          try { lateModel.model?.dispose?.(); } catch { /* Already disposed by the runtime. */ }
        }
      }, () => {});
      const model = await abortable(modelPromise, controller.signal);
      if (model.getTotalClasses() !== labels.length) throw failure('invalid-model', 'O número de classes difere dos rótulos. Publique o modelo novamente.');
      const actualLabels = typeof model.getClassLabels === 'function' ? model.getClassLabels() : labels;
      if (actualLabels.length !== labels.length || actualLabels.some((label, i) => String(label) !== labels[i])) {
        throw failure('invalid-model', 'As classes do modelo não correspondem aos metadados. Publique o modelo novamente.');
      }
      entry.loaded = { model, labels, metadata, modelURL: baseURL };
      announce('Modelo pronto para identificar.', 'ready');
      return entry.loaded;
    } catch (error) {
      if (models.get(baseURL) === entry) models.delete(baseURL);
      if (controller.signal.aborted) throw controller.signal.reason || cancellation();
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
  let entry = models.get(baseURL);
  if (!entry) entry = createEntry(baseURL, callback);
  else if (entry.loaded) report(callback, 'Modelo pronto para identificar.', 'ready');
  else if (typeof callback === 'function') entry.listeners.add(callback);
  const onAbort = () => entry.controller.abort(cancellation());
  signal?.addEventListener('abort', onAbort, { once: true });
  try { return await entry.promise; } finally {
    signal?.removeEventListener('abort', onAbort);
    entry.listeners.delete(callback);
  }
}

/** onProgress(message, stage). Optional third argument: { signal: AbortSignal }. */
export async function loadPlantModel(baseUrl, onProgress, options = {}) {
  const modelURL = validateModelURL(baseUrl);
  const { labels, metadata } = await getEntry(modelURL, onProgress, options.signal);
  return { labels: [...labels], metadata: { ...metadata }, modelURL };
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
  const { model, labels, metadata } = await getEntry(modelURL, onProgress, options.signal);
  if (options.signal?.aborted) throw cancellation();
  report(onProgress, 'Analisando a foto com o seu modelo…', 'predicting');
  let raw;
  try {
    const prediction = model.predict(imageOrCanvas, false);
    raw = options.signal ? await abortable(prediction, options.signal) : await prediction;
  } catch (error) {
    if (options.signal?.aborted || error?.name === 'AbortError') throw cancellation();
    throw failure('prediction-failed', 'Não foi possível processar esta foto. Tente uma nova imagem ou reinicie o aplicativo.', error);
  }
  if (!Array.isArray(raw) || raw.length !== labels.length
      || raw.some(item => !labels.includes(item.className) || !Number.isFinite(item.probability) || item.probability < 0 || item.probability > 1)) {
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
    analyzedAt: new Date().toISOString()
  };
}
