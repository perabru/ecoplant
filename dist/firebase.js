import { getCachedData, putCachedData } from './local-db.js';

export const config = Object.freeze({
  apiKey: 'AIzaSyCkGcNS8nAeaUsRwoMX1PYOFvkg8bbsSAc',
  authDomain: 'wizardsofthesouth-8a2dc.firebaseapp.com',
  databaseURL: 'https://wizardsofthesouth-8a2dc.firebaseio.com',
  projectId: 'wizardsofthesouth-8a2dc',
  storageBucket: 'wizardsofthesouth-8a2dc.appspot.com',
  messagingSenderId: '454680121812',
  appId: '1:454680121812:web:ead8afd635b8f42aba8641',
  measurementId: 'G-FE6YEVMF79'
});

const SDK = 'https://www.gstatic.com/firebasejs/13.2.0/';
const NAMESPACE = 'ecoplant/users';
let sdkAuth, sdkDatabase, auth, db, initializationError;
const privateDatabaseCheckedAt = new Map();
const profileInitializations = new Map();
const registrationNames = new Map();

function problem(code, message) { return Object.assign(new Error(message), { code }); }
const online = () => globalThis.navigator?.onLine !== false;

export function readableError(error) {
  const code = String(error?.code || '').toLowerCase();
  const messages = {
    'auth/unauthorized-domain': 'Este endereço ainda não está autorizado no Firebase. Adicione o domínio do aplicativo em Authentication → Configurações → Domínios autorizados.',
    'auth/operation-not-allowed': 'Este método de login ainda não está ativado. No Firebase Authentication, habilite E-mail/senha e Google.',
    'auth/configuration-not-found': 'O Firebase Authentication ainda precisa ser configurado neste projeto. Ative os provedores E-mail/senha e Google.',
    'auth/invalid-api-key': 'A chave do Firebase foi recusada. Confira a configuração do aplicativo e as restrições da chave no projeto.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'A chave do Firebase foi recusada. Confira a configuração do aplicativo.',
    'auth/invalid-credential': 'Não foi possível entrar. Confira seu e-mail e sua senha.',
    'auth/invalid-login-credentials': 'Não foi possível entrar. Confira seu e-mail e sua senha.',
    'auth/wrong-password': 'Não foi possível entrar. Confira seu e-mail e sua senha.',
    'auth/user-not-found': 'Não foi possível entrar. Confira seu e-mail e sua senha.',
    'auth/invalid-email': 'Informe um e-mail válido.',
    'auth/email-already-in-use': 'Este e-mail já possui uma conta. Entre ou recupere sua senha.',
    'auth/weak-password': 'Use uma senha com pelo menos 8 caracteres.',
    'auth/password-does-not-meet-requirements': 'A senha não atende aos requisitos deste projeto. Use uma senha mais forte.',
    'auth/too-many-requests': 'Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.',
    'auth/user-disabled': 'Esta conta foi desativada. Entre em contato com o responsável pelo aplicativo.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Permita pop-ups para este aplicativo e tente novamente.',
    'auth/popup-closed-by-user': 'A janela do Google foi fechada. Toque em Entrar com Google para tentar novamente.',
    'auth/cancelled-popup-request': 'Já existe uma janela de login aberta. Conclua o acesso por ela.',
    'auth/account-exists-with-different-credential': 'Este e-mail usa outro método de login. Entre com o método utilizado no cadastro.',
    'auth/network-request-failed': 'Sem conexão com o Firebase. Confira a internet e tente novamente.',
    'auth/requires-recent-login': 'Por segurança, saia e entre novamente antes de alterar estes dados.',
    'app/offline': 'Você está sem internet. Os dados salvos continuam disponíveis; reconecte para salvar alterações.',
    'app/auth-required': 'Entre na sua conta para salvar seus dados.',
    'app/invalid-data': 'Confira os dados informados e tente novamente.',
    'app/sdk-unavailable': 'Não foi possível carregar o Firebase. Confira sua conexão e recarregue o aplicativo.',
    'app/timeout': 'O Firebase demorou para responder. Confira a conexão e tente novamente.',
    'database/permission-denied': 'O banco não autorizou este acesso. Confira as regras do Realtime Database para ecoplant/users e tente novamente.',
    'permission_denied': 'O banco não autorizou este acesso. Confira as regras do Realtime Database para ecoplant/users e tente novamente.',
    'database/unavailable': 'O banco de dados está indisponível neste momento. Tente novamente.',
    'database/public-access': 'O banco ainda permite leitura pública do perfil. Configure as regras privadas de ecoplant/users no Firebase antes de salvar seus dados.',
    'auth/web-storage-unsupported': 'O navegador bloqueou o armazenamento de sessão. Permita o armazenamento deste site ou use uma janela comum.'
  };
  if (code === 'database/profile-pending') return error.message;
  if (messages[code]) return messages[code];
  if (/permission.denied/.test(code + ' ' + error?.message)) return messages['database/permission-denied'];
  if (/api.key.not.valid|api_key_invalid/i.test(error?.message || '')) return messages['auth/invalid-api-key'];
  if (error?.name === 'AbortError') return messages['app/timeout'];
  if (!online()) return messages['app/offline'];
  if (error instanceof TypeError) return 'Não foi possível conectar ao serviço. Confira a internet e tente novamente.';
  return 'Não foi possível concluir esta ação. Tente novamente em instantes.';
}

export const ready = (async () => {
  try {
    const [appModule, authModule, databaseModule] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-database.js')
    ]);
    sdkAuth = authModule;
    sdkDatabase = databaseModule;
    const app = appModule.initializeApp(config);
    auth = authModule.getAuth(app);
    auth.languageCode = 'pt-BR';
    db = databaseModule.getDatabase(app);
    return { ok: true, version: '13.2.0' };
  } catch (error) {
    initializationError = error;
    return { ok: false, error: readableError(error) };
  }
})();

async function requireFirebase() {
  const result = await ready;
  if (!result.ok) throw problem('app/sdk-unavailable', initializationError?.message || result.error);
}

export function subscribeAuth(callback, onError = () => {}) {
  let cancelled = false, unsubscribe = () => {};
  ready.then(result => {
    if (cancelled) return;
    if (!result.ok) { callback(null); onError(problem('app/sdk-unavailable', result.error)); return; }
    unsubscribe = sdkAuth.onAuthStateChanged(auth, user => { if (!cancelled) callback(user); }, error => { if (!cancelled) onError(error); });
  });
  return () => { cancelled = true; unsubscribe(); };
}

async function persistence(remember) {
  await requireFirebase();
  if (!online()) throw problem('app/offline');
  await sdkAuth.setPersistence(auth, remember ? sdkAuth.browserLocalPersistence : sdkAuth.browserSessionPersistence);
}

function emailValue(value) {
  const email = String(value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw problem('auth/invalid-email');
  return email;
}

export async function login(email, password, remember = true) {
  await persistence(remember);
  const credential = await sdkAuth.signInWithEmailAndPassword(auth, emailValue(email), String(password || ''));
  await completeProfile(credential.user);
  return credential.user;
}

export async function register(name, email, password, remember = true) {
  const displayName = String(name || '').trim();
  if (!displayName || displayName.length > 120) throw problem('app/invalid-data');
  if (String(password || '').length < 8) throw problem('auth/weak-password');
  await persistence(remember);
  const normalizedEmail = emailValue(email);
  // onAuthStateChanged can run before createUserWithEmailAndPassword resolves.
  // Seed the requested name before that callback can initialize the database profile.
  registrationNames.set(normalizedEmail.toLowerCase(), displayName);
  let user;
  try {
    const credential = await sdkAuth.createUserWithEmailAndPassword(auth, normalizedEmail, String(password));
    user = credential.user;
    await sdkAuth.updateProfile(user, { displayName });
    await completeProfile(user, true);
    return user;
  } catch (error) {
    if (user && error.code !== 'database/profile-pending') throw profilePending(user, error, true);
    throw error;
  } finally {
    registrationNames.delete(normalizedEmail.toLowerCase());
  }
}

export async function loginGoogle(remember = true) {
  await persistence(remember);
  const provider = new sdkAuth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  // Popup avoids redirect flows relying on third-party storage in Safari.
  const credential = await sdkAuth.signInWithPopup(auth, provider);
  await completeProfile(credential.user);
  return credential.user;
}

function profilePending(user, cause, created = false) {
  const message = (created ? 'Sua conta foi criada' : 'Você entrou na sua conta') + ', mas o perfil ainda não pôde ser salvo no banco. ' + readableError(cause) + ' A conta foi preservada; não é necessário cadastrar novamente.';
  return Object.assign(problem('database/profile-pending', message), { authSucceeded: true, user, cause });
}

async function completeProfile(user, created = false) {
  try { return await ensureProfile(user); }
  catch (error) { throw profilePending(user, error, created); }
}

export async function logout() { await requireFirebase(); await sdkAuth.signOut(auth); }

export async function recover(email) {
  await requireFirebase();
  if (!online()) throw problem('app/offline');
  await sdkAuth.sendPasswordResetEmail(auth, emailValue(email));
  return { message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha.' };
}

export async function updateUserProfile({ displayName, photoURL } = {}) {
  await requireFirebase();
  if (!online()) throw problem('app/offline');
  if (!auth.currentUser) throw problem('app/auth-required');
  const changes = {};
  if (displayName !== undefined) {
    changes.displayName = String(displayName).trim();
    if (!changes.displayName || changes.displayName.length > 120) throw problem('app/invalid-data');
  }
  if (photoURL !== undefined) changes.photoURL = photoURL;
  await sdkAuth.updateProfile(auth.currentUser, changes);
  return auth.currentUser;
}

function safeId(id) {
  const value = String(id || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw problem('app/invalid-data');
  return value;
}

function clean(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => item === undefined ? null : item));
}

async function requirePrivateDatabase(uid) {
  safeId(uid);
  if (Date.now() - (privateDatabaseCheckedAt.get(uid) || 0) < 60000) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${config.databaseURL}/${NAMESPACE}/${uid}.json?shallow=true`, {
      cache: 'no-store', signal: controller.signal
    });
    // Firebase grants at a parent path cannot be revoked by a child rule.
    // Probe this exact UID: a protected parent can still contain a publicly readable child.
    // The shallow response is never parsed or displayed.
    if (response.ok) throw problem('database/public-access');
    if (response.status !== 401 && response.status !== 403) throw problem('database/unavailable');
    privateDatabaseCheckedAt.set(uid, Date.now());
  } finally { clearTimeout(timeout); }
}

async function write(uid, path, value, method = 'PUT', extraHeaders = {}) {
  await requireFirebase();
  if (!online()) throw problem('app/offline');
  if (!auth.currentUser || auth.currentUser.uid !== uid) throw problem('app/auth-required');
  safeId(uid);
  await requirePrivateDatabase(uid);
  const token = await auth.currentUser.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    // REST writes fail explicitly instead of becoming an unacknowledged offline SDK queue.
    const response = await fetch(`${config.databaseURL}/${NAMESPACE}/${uid}/${path}.json?auth=${encodeURIComponent(token)}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: method === 'DELETE' ? undefined : JSON.stringify(clean(value)),
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!response.ok) {
      if (response.status === 412) throw problem('database/conflict');
      if (response.status === 401 || response.status === 403) throw problem('database/permission-denied');
      if (response.status === 400) throw problem('app/invalid-data');
      throw problem('database/unavailable');
    }
    return value;
  } finally { clearTimeout(timeout); }
}

async function readOwnProfile(uid) {
  await requireFirebase();
  if (!online()) throw problem('app/offline');
  if (!auth.currentUser || auth.currentUser.uid !== uid) throw problem('app/auth-required');
  safeId(uid);
  await requirePrivateDatabase(uid);
  const token = await auth.currentUser.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${config.databaseURL}/${NAMESPACE}/${uid}/profile.json?auth=${encodeURIComponent(token)}`, {
      headers: { 'X-Firebase-ETag': 'true' }, cache: 'no-store', signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) throw problem('database/permission-denied');
    if (!response.ok) throw problem('database/unavailable');
    return { profile: await response.json(), etag: response.headers.get('ETag') };
  } finally { clearTimeout(timeout); }
}

export function ensureProfile(user) {
  const uid = user?.uid;
  if (!uid) return Promise.reject(problem('app/auth-required'));
  if (profileInitializations.has(uid)) return profileInitializations.get(uid);
  const pending = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { profile: value, etag } = await readOwnProfile(uid);
      const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const record = { ...current };
      let changed = false;
      const fill = (field, fallback) => {
        if (record[field] === undefined || record[field] === null || record[field] === '') {
          record[field] = fallback;
          changed = true;
        }
      };
      const seededName = registrationNames.get(String(user.email || '').toLowerCase());
      const name = String(current.name || current.displayName || seededName || user.displayName || user.email?.split('@')[0] || 'Usuário').slice(0, 120);
      fill('name', name);
      fill('displayName', name);
      fill('email', String(user.email || '').slice(0, 320));
      const accountCreated = Date.parse(user.metadata?.creationTime || '');
      if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt) || record.createdAt < 0) {
        record.createdAt = Number.isFinite(accountCreated) ? accountCreated : Date.now();
        changed = true;
      }
      if (!changed && typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) && record.updatedAt >= 0) return record;
      record.updatedAt = Date.now();
      if (!etag) throw problem('database/unavailable');
      try {
        await write(uid, 'profile', record, 'PUT', { 'If-Match': etag });
        return record;
      } catch (error) {
        // Someone edited the profile after our read. Re-read and only fill missing fields.
        if (error.code !== 'database/conflict' || attempt === 2) throw error;
      }
    }
    throw problem('database/unavailable');
  })();
  profileInitializations.set(uid, pending);
  pending.then(() => profileInitializations.delete(uid), () => profileInitializations.delete(uid));
  return pending;
}

export async function savePlant(uid, plant) {
  const id = safeId(plant?.id || crypto.randomUUID());
  const name = String(plant?.name || '').trim();
  if (!name || name.length > 120 || String(plant?.photo || '').length > 240000) throw problem('app/invalid-data');
  const record = { ...plant, id, name, createdAt: plant.createdAt || Date.now(), updatedAt: Date.now() };
  await write(uid, `plants/${id}`, record);
  return record;
}

export async function deletePlant(uid, id) {
  await write(uid, `plants/${safeId(id)}`, null, 'DELETE');
}

export async function saveAnalysis(uid, analysis) {
  const id = safeId(analysis?.id || crypto.randomUUID());
  if (analysis?.plantId) safeId(analysis.plantId);
  if (String(analysis?.photo || '').length > 240000) throw problem('app/invalid-data');
  const record = { ...analysis, id, createdAt: analysis.createdAt || Date.now(), updatedAt: Date.now() };
  await write(uid, `analyses/${id}`, record);
  return record;
}

export async function deleteAnalysis(uid, id) {
  await write(uid, `analyses/${safeId(id)}`, null, 'DELETE');
}

export async function saveProfile(uid, profile) {
  const allowed = ['name', 'displayName', 'email', 'photoURL', 'photo', 'reminders', 'createdAt', 'modelURL', 'healthyClass'];
  const record = { updatedAt: Date.now() };
  for (const key of allowed) if (profile?.[key] !== undefined) record[key] = profile[key];
  if (String(record.photo || '').length > 240000 || String(record.displayName || record.name || '').length > 120) throw problem('app/invalid-data');
  if (record.modelURL !== undefined && record.modelURL !== '' && !/^https:\/\/teachablemachine\.withgoogle\.com\/models\/[A-Za-z0-9_-]+\/?$/.test(String(record.modelURL))) throw problem('app/invalid-data');
  if (String(record.modelURL || '').length > 300 || String(record.healthyClass || '').length > 200 || (record.reminders !== undefined && typeof record.reminders !== 'boolean')) throw problem('app/invalid-data');
  await write(uid, 'profile', record, 'PATCH');
  return record;
}

function toArray(value) {
  return Object.entries(value || {}).filter(([, item]) => item && typeof item === 'object').map(([id, item]) => ({ ...item, id })).sort((a, b) => (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0));
}

export function subscribeData(uid, callback, onError = () => {}) {
  let active = true, receivedCloud = false, unsubscribe = () => {};
  getCachedData(uid).then(cached => { if (active && !receivedCloud && cached) callback({ ...cached, source: 'cache' }); });
  ready.then(result => {
    if (!active) return;
    if (!result.ok) { onError(problem('app/sdk-unavailable')); return; }
    if (!auth.currentUser || auth.currentUser.uid !== uid) { onError(problem('app/auth-required')); return; }
    try {
      const reference = sdkDatabase.ref(db, `${NAMESPACE}/${safeId(uid)}`);
      unsubscribe = sdkDatabase.onValue(reference, snapshot => {
        if (!active) return;
        receivedCloud = true;
        const raw = snapshot.val() || {};
        const data = { profile: raw.profile || {}, plants: toArray(raw.plants), analyses: toArray(raw.analyses) };
        callback({ ...data, source: 'cloud' });
        void putCachedData(uid, data);
      }, error => { if (active) onError(error); });
    } catch (error) { if (active) onError(error); }
  });
  return () => { active = false; unsubscribe(); };
}

export async function checkConnection() {
  const result = { online: online(), projectId: config.projectId, authDomain: config.authDomain, sdk: await ready, authorizedDomains: [], authStatus: 'unknown', databaseStatus: 'unknown' };
  if (!result.online) return result;
  const inspect = async (url, readBody = true) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const body = readBody ? await response.json() : undefined;
      return { status: response.status, body };
    } finally { clearTimeout(timeout); }
  };
  await Promise.allSettled([
    (async () => {
      const { status, body } = await inspect(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(config.apiKey)}`);
      result.authStatus = status === 200 ? 'available' : 'configuration-required';
      result.authorizedDomains = body.authorizedDomains || [];
      if (body.error) result.authError = body.error.message;
      result.currentDomainAuthorized = result.authorizedDomains.includes(globalThis.location?.hostname);
    })(),
    (async () => {
      // Probe the signed-in UID when available; a protected parent alone does not prove private children.
      const uid = auth?.currentUser?.uid;
      const path = uid ? `${NAMESPACE}/${safeId(uid)}` : 'ecoplant';
      result.databaseScope = uid ? 'current-user' : 'namespace';
      const { status } = await inspect(`${config.databaseURL}/${path}.json?shallow=true`, false);
      result.databaseStatus = status === 200 ? 'reachable-public-namespace' : status === 401 || status === 403 ? 'protected' : 'configuration-required';
    })()
  ]);
  return result;
}
