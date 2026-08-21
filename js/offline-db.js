const DB_NAME = 'tornei_scuola_offline';
const DB_VERSION = 1;

const STORES = {
  LIVE_CACHE: 'live_cache',
  OPERATIONS: 'operation_queue',
  META: 'meta',
};

let dbPromise = null;

function hasIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openOfflineDb() {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.LIVE_CACHE)) {
        db.createObjectStore(STORES.LIVE_CACHE, { keyPath: 'match_id' });
      }
      if (!db.objectStoreNames.contains(STORES.OPERATIONS)) {
        const store = db.createObjectStore(STORES.OPERATIONS, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('match_id', 'match_id', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

async function withStore(storeName, mode, callback) {
  const db = await openOfflineDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let callbackResult;

    tx.oncomplete = () => resolve(callbackResult);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);

    callbackResult = callback(store);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putLiveCacheEntry(entry) {
  if (!entry?.match_id) return false;
  try {
    await withStore(STORES.LIVE_CACHE, 'readwrite', (store) => store.put(entry));
    return true;
  } catch (_error) {
    return false;
  }
}

export async function getLiveCacheEntry(matchId) {
  try {
    const request = await withStore(STORES.LIVE_CACHE, 'readonly', (store) => store.get(Number(matchId)));
    return request ? await requestToPromise(request) : null;
  } catch (_error) {
    return null;
  }
}

export async function listLiveCacheEntries() {
  try {
    const request = await withStore(STORES.LIVE_CACHE, 'readonly', (store) => store.getAll());
    return request ? await requestToPromise(request) : [];
  } catch (_error) {
    return [];
  }
}

export async function putMeta(key, value) {
  try {
    await withStore(STORES.META, 'readwrite', (store) => store.put({ key, value }));
    return true;
  } catch (_error) {
    return false;
  }
}

export async function getMeta(key, fallback = null) {
  try {
    const request = await withStore(STORES.META, 'readonly', (store) => store.get(key));
    const row = request ? await requestToPromise(request) : null;
    return row?.value ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

export async function enqueueOfflineOperation({ type, matchId = null, payload = {}, summary = '' }) {
  const now = new Date().toISOString();
  const id = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const operation = {
    id,
    type,
    match_id: matchId ? Number(matchId) : null,
    payload,
    summary,
    status: 'queued',
    attempts: 0,
    created_at: now,
    updated_at: now,
    last_error: null,
  };

  try {
    await withStore(STORES.OPERATIONS, 'readwrite', (store) => store.put(operation));
    return operation;
  } catch (_error) {
    return null;
  }
}

export async function listOfflineOperations({ status = null } = {}) {
  try {
    const request = await withStore(STORES.OPERATIONS, 'readonly', (store) => store.getAll());
    const rows = request ? await requestToPromise(request) : [];
    return status ? rows.filter((row) => row.status === status) : rows;
  } catch (_error) {
    return [];
  }
}

export async function updateOfflineOperation(id, patch = {}) {
  try {
    const current = await new Promise((resolve, reject) => {
      openOfflineDb()
        .then((db) => {
          if (!db) return resolve(null);
          const tx = db.transaction(STORES.OPERATIONS, 'readwrite');
          const store = tx.objectStore(STORES.OPERATIONS);
          const getRequest = store.get(id);
          getRequest.onsuccess = () => {
            const next = {
              ...(getRequest.result ?? { id }),
              ...patch,
              updated_at: new Date().toISOString(),
            };
            store.put(next);
            resolve(next);
          };
          getRequest.onerror = () => reject(getRequest.error);
        })
        .catch(reject);
    });
    return current;
  } catch (_error) {
    return null;
  }
}

export async function getOfflineStorageSummary() {
  const [matches, operations] = await Promise.all([
    listLiveCacheEntries(),
    listOfflineOperations(),
  ]);

  return {
    indexedDbAvailable: hasIndexedDb(),
    cachedMatches: matches.length,
    liveCacheCount: matches.length,
    queuedOperations: operations.filter((operation) => operation.status === 'queued').length,
    queuedOperationsCount: operations.filter((operation) => operation.status === 'queued').length,
    syncedOperations: operations.filter((operation) => operation.status === 'synced').length,
    conflictOperations: operations.filter((operation) => operation.status === 'conflict').length,
  };
}
