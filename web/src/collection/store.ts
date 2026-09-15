import type { Stack } from "./cards";

// The last read of a collection, so opening the app paints before the repo
// answers. Disposable in a way the import's database is not: losing this costs
// one read, and `listRecords` is always what settles it.
const DATABASE = "manaweb-collection";
const STORE = "stacks";

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function open(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE);
  };
  return settle(request);
}

// Keyed by whose repo it came from, so two accounts on one browser never read
// each other's cards.
export async function recall(did: string): Promise<Stack[] | null> {
  try {
    const db = await open();
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      return (await settle(store.get(did))) ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function remember(did: string, stacks: Stack[]): Promise<void> {
  try {
    const db = await open();
    try {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE);
      await settle(store.put(stacks, did));
    } finally {
      db.close();
    }
  } catch {
    // A private window, or no room. The repo is still the truth.
  }
}
