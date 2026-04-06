import { useAuthStore } from '../store/authStore';

const DB_NAME = 'psysonic-img-cache';
const STORE_NAME = 'images';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_MEMORY_CACHE = 150; // max object URLs kept in RAM
const MAX_CONCURRENT_FETCHES = 5;

// In-memory map: cacheKey → object URL (insertion-order = LRU approximation)
const objectUrlCache = new Map<string, string>();

// Concurrency limiter for network fetches.
// Each queue entry is a resolver that signals "slot acquired".
let activeFetches = 0;
const fetchQueue: Array<() => void> = [];

/**
 * Acquires a fetch slot. Returns true if a slot was granted, false if the
 * provided AbortSignal fired while the call was waiting in the queue (in that
 * case no slot is held and the caller must NOT call releaseFetchSlot).
 */
function acquireFetchSlot(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++;
    return Promise.resolve(true);
  }
  return new Promise<boolean>(resolve => {
    const onGrant = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    };
    const onAbort = () => {
      // Remove from queue without consuming a slot — no releaseFetchSlot needed.
      const idx = fetchQueue.indexOf(onGrant);
      if (idx !== -1) fetchQueue.splice(idx, 1);
      resolve(false);
    };
    fetchQueue.push(onGrant);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function releaseFetchSlot(): void {
  activeFetches--;
  const next = fetchQueue.shift();
  if (next) { activeFetches++; next(); }
}

function evictMemoryIfNeeded(): void {
  while (objectUrlCache.size > MAX_MEMORY_CACHE) {
    const oldestKey = objectUrlCache.keys().next().value;
    if (!oldestKey) break;
    URL.revokeObjectURL(objectUrlCache.get(oldestKey)!);
    objectUrlCache.delete(oldestKey);
  }
}

let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = e => {
      db = (e.target as IDBOpenDBRequest).result;
      resolve(db!);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function getBlob(key: string): Promise<Blob | null> {
  try {
    const database = await openDB();
    return new Promise(resolve => {
      const req = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const entry = req.result;
        resolve(entry && Date.now() - entry.timestamp < MAX_AGE_MS ? entry.blob : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Evicts oldest IDB entries until total blob size is below maxBytes. Fire-and-forget. */
async function evictDiskIfNeeded(maxBytes: number): Promise<void> {
  try {
    const database = await openDB();
    const entries: Array<{ key: string; timestamp: number; size: number }> = await new Promise(resolve => {
      const req = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        resolve(
          (req.result ?? []).map((e: { key: string; timestamp: number; blob: Blob }) => ({
            key: e.key,
            timestamp: e.timestamp,
            size: e.blob?.size ?? 0,
          })),
        );
      };
      req.onerror = () => resolve([]);
    });

    let total = entries.reduce((acc, e) => acc + e.size, 0);
    if (total <= maxBytes) return;

    // Oldest first
    entries.sort((a, b) => a.timestamp - b.timestamp);

    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const entry of entries) {
      if (total <= maxBytes) break;
      store.delete(entry.key);
      // Also purge from memory cache
      const objUrl = objectUrlCache.get(entry.key);
      if (objUrl) {
        URL.revokeObjectURL(objUrl);
        objectUrlCache.delete(entry.key);
      }
      total -= entry.size;
    }
  } catch {
    // Ignore
  }
}

async function putBlob(key: string, blob: Blob): Promise<void> {
  try {
    const database = await openDB();
    await new Promise<void>(resolve => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ key, blob, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    // Enforce disk limit after write (fire-and-forget)
    const maxBytes = useAuthStore.getState().maxCacheMb * 1024 * 1024;
    evictDiskIfNeeded(maxBytes);
  } catch {
    // Ignore write errors
  }
}

/** Returns the total size in bytes of all blobs stored in IndexedDB. */
export async function getImageCacheSize(): Promise<number> {
  try {
    const database = await openDB();
    return new Promise(resolve => {
      const req = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const entries: Array<{ blob: Blob }> = req.result ?? [];
        resolve(entries.reduce((acc, e) => acc + (e.blob?.size ?? 0), 0));
      };
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

/** Removes a single cache entry from both in-memory and IndexedDB caches. */
export async function invalidateCacheKey(cacheKey: string): Promise<void> {
  const existing = objectUrlCache.get(cacheKey);
  if (existing) {
    URL.revokeObjectURL(existing);
    objectUrlCache.delete(cacheKey);
  }
  try {
    const database = await openDB();
    await new Promise<void>(resolve => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(cacheKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  }
}

/** Clears all entries from IndexedDB and revokes all in-memory object URLs. */
export async function clearImageCache(): Promise<void> {
  for (const url of objectUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  objectUrlCache.clear();
  try {
    const database = await openDB();
    await new Promise<void>(resolve => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  }
}

/**
 * Returns a cached object URL for an image.
 * @param fetchUrl  The actual URL to fetch from (may contain ephemeral auth params).
 * @param cacheKey  A stable key that identifies the image across sessions.
 * @param signal    Optional AbortSignal — aborts queue-waiting and in-flight fetches
 *                  so navigating away does not leave zombie fetches draining I/O.
 */
export async function getCachedUrl(fetchUrl: string, cacheKey: string, signal?: AbortSignal): Promise<string> {
  if (!fetchUrl || signal?.aborted) return '';

  // 1. In-memory hit (same session)
  const existing = objectUrlCache.get(cacheKey);
  if (existing) return existing;

  // 2. IndexedDB hit (persisted from previous session)
  const blob = await getBlob(cacheKey);
  if (signal?.aborted) return '';
  if (blob) {
    const objUrl = URL.createObjectURL(blob);
    objectUrlCache.set(cacheKey, objUrl);
    evictMemoryIfNeeded();
    return objUrl;
  }

  // 3. Network fetch with concurrency limit → store in IDB → return object URL.
  // acquireFetchSlot returns false (without holding a slot) when aborted in queue.
  const acquired = await acquireFetchSlot(signal);
  if (!acquired || signal?.aborted) {
    if (acquired) releaseFetchSlot();
    return '';
  }
  try {
    const resp = await fetch(fetchUrl);
    if (!resp.ok) return fetchUrl;
    const newBlob = await resp.blob();
    if (signal?.aborted) return '';
    putBlob(cacheKey, newBlob); // fire-and-forget (includes disk eviction)
    const objUrl = URL.createObjectURL(newBlob);
    objectUrlCache.set(cacheKey, objUrl);
    evictMemoryIfNeeded();
    return objUrl;
  } catch (e) {
    // AbortError → return '' (component is gone). Other errors → return raw URL.
    return e instanceof DOMException && e.name === 'AbortError' ? '' : fetchUrl;
  } finally {
    releaseFetchSlot();
  }
}
