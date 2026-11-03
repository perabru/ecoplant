// Cached garden records are separated by Firebase UID. Authentication is owned by Firebase.
const DB_NAME = 'ecoplant-v1';
const STORE = 'accounts';
const memory = new Map();
let database;

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve) => {
    if (!globalThis.indexedDB) return resolve(null);
    let request;
    try { request = indexedDB.open(DB_NAME, 1); } catch { return resolve(null); }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'uid' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return database;
}

export async function getCachedData(uid) {
  if (!uid) return null;
  const db = await openDatabase();
  if (!db) return memory.get(uid) || null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(uid);
      request.onsuccess = () => resolve(request.result?.data || memory.get(uid) || null);
      request.onerror = () => resolve(memory.get(uid) || null);
    } catch { resolve(memory.get(uid) || null); }
  });
}

export async function putCachedData(uid, data) {
  if (!uid) return false;
  memory.set(uid, data);
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put({ uid, data, savedAt: Date.now() });
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

export async function clearCachedData(uid) {
  if (!uid) return;
  memory.delete(uid);
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(uid);
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    } catch { resolve(); }
  });
}
