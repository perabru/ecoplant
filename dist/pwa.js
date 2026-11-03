let deferredInstall = null;
let registration = null;
let initialized = false;
let callbacks = {};

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function canInstall() {
  return Boolean(deferredInstall) && !isStandalone();
}

export async function installApp() {
  if (isStandalone()) return { installed: true, instructions: 'O Ecoplant já está aberto pela tela de início.' };
  if (deferredInstall) {
    const prompt = deferredInstall;
    deferredInstall = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    callbacks.onInstallAvailable?.(false);
    return { installed: choice.outcome === 'accepted', outcome: choice.outcome };
  }
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return { installed: false, platform: 'ios', instructions: 'No iPhone ou iPad, abra este endereço no Safari. Toque em Compartilhar, depois em Adicionar à Tela de Início e confirme em Adicionar. Se aparecer, mantenha Abrir como App da Web ativado.' };
  if (/Android/i.test(ua)) return { installed: false, platform: 'android', instructions: 'No Android, abra este endereço no Chrome. Toque no menu de três pontos e escolha Instalar aplicativo ou Adicionar à tela inicial. O nome da opção pode variar conforme o navegador.' };
  return { installed: false, platform: 'desktop', instructions: 'No Chrome ou Edge, procure o ícone de instalação na barra de endereços ou a opção Instalar aplicativo no menu do navegador. A disponibilidade depende do navegador.' };
}

export async function applyUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) return false;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export function initPWA(options = {}) {
  callbacks = options;
  if (initialized) return registration;
  initialized = true;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstall = event;
    callbacks.onInstallAvailable?.(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    callbacks.onInstallAvailable?.(false);
    window.dispatchEvent(new CustomEvent('pwa:installed'));
  });
  const connectionChanged = () => callbacks.onOnlineChange?.(navigator.onLine);
  window.addEventListener('online', connectionChanged);
  window.addEventListener('offline', connectionChanged);
  connectionChanged();
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'UPDATE_READY' && registration?.waiting && navigator.serviceWorker.controller) {
      callbacks.onUpdateAvailable?.(registration);
      window.dispatchEvent(new CustomEvent('pwa:update-ready', { detail: registration }));
    }
  });
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: './', updateViaCache: 'none' }).then(reg => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) callbacks.onUpdateAvailable?.(reg);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          callbacks.onUpdateAvailable?.(reg);
          window.dispatchEvent(new CustomEvent('pwa:update-ready', { detail: reg }));
        }
      });
    });
  }).catch(error => {
    console.warn('Não foi possível preparar o acesso offline.', error);
    window.dispatchEvent(new CustomEvent('pwa:error', { detail: error }));
  });
  return null;
}
