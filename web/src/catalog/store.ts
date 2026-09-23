// The catalog cached as the bytes that came off the wire, keyed by the
// content-addressed filename, so no name ever needs invalidating.
//
// Every call resolves rather than throwing: a browser with site data blocked
// opens no database at all, and the catalog is re-fetchable.

const DATABASE = "manaweb";
const STORE = "catalog";

// Cached too, so a load with no network knows which pair to look for.
export const MANIFEST = "manifest.json";

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Resolves when the transaction commits, not when the request succeeds: a
// quota that only bites at commit aborts it after `onsuccess` has fired, so a
// write awaiting the request alone reports storing what it did not store.
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function open(): Promise<IDBDatabase | null> {
  try {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    return await settle(request);
  } catch {
    return null;
  }
}

export async function read(name: string): Promise<ArrayBuffer | null> {
  const db = await open();
  if (!db) return null;
  try {
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    return (await settle(store.get(name))) ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// Says whether the bytes reached the disk, because the manifest is only
// cached once the pair it names is — see `load`.
export async function write(
  name: string,
  bytes: ArrayBuffer,
): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(bytes, name);
    await committed(transaction);
    return true;
  } catch {
    // A full disk or a denied quota leaves the catalog working, just uncached.
    return false;
  } finally {
    db.close();
  }
}

export async function clear(): Promise<void> {
  try {
    await settle(indexedDB.deleteDatabase(DATABASE));
  } catch {
    // Nothing cached, or nothing that can be.
  }
}

export async function prune(keep: string[]): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const names = await settle(store.getAllKeys());
    const wanted = new Set<IDBValidKey>([...keep, MANIFEST]);
    for (const name of names) {
      if (!wanted.has(name)) store.delete(name);
    }
    await committed(transaction);
  } catch {
    // Stale files cost space, not correctness.
  } finally {
    db.close();
  }
}
