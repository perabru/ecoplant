/* Ecoplant startup and real-operation progress. See notices/experience-licenses.txt. */
const SPLASH_MIN = 1300;
const SPLASH_FALLBACK = 8000;
let initialized = false;
let splash, loading, splashStarted = 0, splashTimer, splashFallback, splashFinishing;
let nextOperation = 0;
const operations = new Map();
let oldOverflow, previousFocus;

/** Original seven-cell Uiverse honeycomb markup, scoped for Ecoplant. */
export function loaderHTML({ small = false } = {}) {
  return `<span class="eco-loader${small ? ' eco-loader-small' : ''}" aria-hidden="true"><span class="eco-honeycomb">${'<span></span>'.repeat(7)}</span></span>`;
}

function plantHTML() {
  return `<div class="eco-plant-wrap" aria-hidden="true"><div class="eco-plant-base"><div class="eco-flowerpot"></div><div class="eco-blade eco-blade-center"></div><div class="eco-blade eco-blade-left-s"></div><div class="eco-blade eco-blade-right-s"></div><div class="eco-blade eco-blade-left-l"></div><div class="eco-blade eco-blade-right-l"></div></div></div>`;
}

function ensureStyles() {
  const url = new URL('./experience.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === url)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.ecoExperience = '';
  document.head.appendChild(link);
}

function syncBusy() {
  const busy = operations.size > 0 || Boolean(splash?.isConnected && !splash.hidden);
  const app = document.getElementById('app');
  if (app) app.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (busy && oldOverflow === undefined) {
    oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  } else if (!busy && oldOverflow !== undefined) {
    document.body.style.overflow = oldOverflow;
    oldOverflow = undefined;
  }
}

function dismissSplash() {
  clearTimeout(splashFallback);
  clearTimeout(splashTimer);
  if (!splash?.isConnected) { syncBusy(); return; }
  splash.classList.add('eco-splash-leaving');
  splash.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    splash?.remove();
    splash = null;
    syncBusy();
  }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 230);
}

/** Call once when the app module starts. Creates only one splash and busy overlay. */
export function initExperience() {
  if (initialized) return;
  initialized = true;
  ensureStyles();
  splashStarted = performance.now();
  splash = document.getElementById('eco-splash') || document.querySelector('[data-eco-splash]');
  if (!splash) {
    splash = document.createElement('section');
    splash.id = 'eco-splash';
    document.body.appendChild(splash);
  }
  splash.classList.add('eco-splash');
  splash.setAttribute('role', 'status');
  splash.setAttribute('aria-live', 'polite');
  splash.setAttribute('aria-atomic', 'true');
  splash.setAttribute('aria-label', 'Ecoplant iniciando');
  splash.innerHTML = `<div class="eco-splash-content">${plantHTML()}<h1 class="eco-splash-logo">Ecoplant<span aria-hidden="true">.</span></h1><p class="eco-splash-tagline">Cada folha, uma história.</p><div class="eco-splash-progress">${loaderHTML({small:true})}<span class="eco-splash-status">Preparando seu jardim…</span></div><div class="eco-splash-recovery" hidden><p>A abertura está demorando mais que o esperado.</p><button type="button" class="eco-experience-retry">Tentar novamente</button><button type="button" class="eco-experience-continue">Continuar sem aguardar</button></div></div>`;
  splash.querySelector('.eco-experience-retry').addEventListener('click', () => location.reload());
  splash.querySelector('.eco-experience-continue').addEventListener('click', dismissSplash);
  splashFallback = setTimeout(() => {
    if (!splash?.isConnected || splashFinishing) return;
    splash.classList.add('eco-splash-delayed');
    splash.querySelector('.eco-splash-progress').hidden = true;
    splash.querySelector('.eco-splash-recovery').hidden = false;
    splash.setAttribute('aria-label', 'A abertura do Ecoplant está demorando');
  }, SPLASH_FALLBACK);

  loading = document.getElementById('eco-loading');
  if (!loading) {
    loading = document.createElement('div');
    loading.id = 'eco-loading';
    document.body.appendChild(loading);
  }
  loading.className = 'eco-loading-overlay';
  loading.hidden = true;
  loading.innerHTML = `<div class="eco-loading-card" role="status" aria-live="polite" aria-atomic="true">${loaderHTML()}<p class="eco-loading-message">Só um instante…</p><span class="eco-loading-detail">Ecoplant</span></div>`;
  syncBusy();
}

/** Call after the first usable app view/auth restoration settles, including error paths. */
export function finishSplash() {
  if (!initialized) initExperience();
  if (splashFinishing) return splashFinishing;
  clearTimeout(splashFallback);
  const remaining = Math.max(0, SPLASH_MIN - (performance.now() - splashStarted));
  splashFinishing = new Promise(resolve => {
    splashTimer = setTimeout(() => { dismissSplash(); resolve(); }, remaining);
  });
  return splashFinishing;
}

/** Returns an operation token; use hideLoading(token) in that operation's finally. */
export function showLoading(message = 'Só um instante…') {
  if (!initialized) initExperience();
  const token = ++nextOperation;
  if (!operations.size) previousFocus = document.activeElement;
  operations.set(token, String(message));
  loading.hidden = false;
  updateLoading(message, token);
  syncBusy();
  return token;
}

/** Update the current real task; optional token keeps concurrent task messages separate. */
export function updateLoading(message = 'Só um instante…', token) {
  if (!loading) return;
  const activeToken = token ?? [...operations.keys()].at(-1);
  if (activeToken !== undefined && operations.has(activeToken)) operations.set(activeToken, String(message));
  loading.querySelector('.eco-loading-message').textContent = String(message);
}

/** Without a token, releases the most recent task. Every show must have one release. */
export function hideLoading(token) {
  const activeToken = token ?? [...operations.keys()].at(-1);
  operations.delete(activeToken);
  if (operations.size) {
    const message = [...operations.values()].at(-1);
    loading.querySelector('.eco-loading-message').textContent = message;
  } else if (loading) {
    loading.hidden = true;
    if (previousFocus?.isConnected && document.activeElement === document.body) {
      try { previousFocus.focus({preventScroll:true}); } catch { /* Removed or non-focusable. */ }
    }
    previousFocus = null;
  }
  syncBusy();
}
