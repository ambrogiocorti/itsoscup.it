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
  const db=await openOfflineDb();
  if(!db)return null;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,mode);
    const store=tx.objectStore(storeName);
    let output=null;
    try{
      const request=callback(store);
      if(request && typeof request==='object' && 'onsuccess' in request){
        // IDB events fire BEFORE transaction completion: capture result here.
        request.onsuccess=()=>{output=request.result;};
      }else output=request;
    }catch(error){
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete=()=>resolve(output);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error('Transazione locale annullata'));
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
    return await withStore(STORES.LIVE_CACHE, 'readonly', (store) => store.get(Number(matchId)));
  } catch (_error) {
    return null;
  }
}

export async function listLiveCacheEntries() {
  try {
    return (await withStore(STORES.LIVE_CACHE, 'readonly', (store) => store.getAll())) ?? [];
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
    const row = await withStore(STORES.META, 'readonly', (store) => store.get(key));
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

/** Preserve a transferred operation UUID; never overwrite the receiver's existing record. */
export async function addOfflineOperationIfAbsent(operation) {
  const db=await openOfflineDb();
  if(!db)throw new Error('IndexedDB non disponibile: impossibile importare senza salvataggio persistente');
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORES.OPERATIONS,'readwrite');
    const store=tx.objectStore(STORES.OPERATIONS);
    let inserted=false;
    const lookup=store.get(operation.id);
    lookup.onsuccess=()=>{
      if(lookup.result)return;
      store.add(operation);inserted=true;
    };
    tx.oncomplete=()=>resolve(inserted);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  });
}
export async function listOfflineOperations({ status = null } = {}) {
  try {
    const rows = (await withStore(STORES.OPERATIONS, 'readonly', (store) => store.getAll())) ?? [];
    return status ? rows.filter((row) => row.status === status) : rows;
  } catch (_error) {
    return [];
  }
}

export async function updateOfflineOperation(id, patch = {}) {
  try {
    const db=await openOfflineDb();
    if(!db)return null;
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORES.OPERATIONS,'readwrite');
      const store=tx.objectStore(STORES.OPERATIONS);
      let updated=null;
      const get=store.get(id);
      get.onsuccess=()=>{
        if(!get.result)return;
        updated={...get.result,...patch,updated_at:new Date().toISOString()};
        store.put(updated);
      };
      tx.oncomplete=()=>resolve(updated);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  }catch(_error){return null;}
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
