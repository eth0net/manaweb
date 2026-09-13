import type { Step } from "./plan";

// An import as it stands, so a closed tab picks it up rather than starting
// over. Its own database: the catalog's is a cache anyone may clear, and half
// a written import is not.
const DATABASE = "manaweb-import";
const STORE = "job";
const KEY = "current";

// Whose repo it is writing to, what it planned, and how much of it landed.
export type Job = { did: string; steps: Step[]; done: number };

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

// Throws where the catalog's cache resolves: an import that cannot record what
// it did is one nobody can resume, which is worth saying before it starts.
export async function save(job: Job): Promise<void> {
  const db = await open();
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    await settle(store.put(job, KEY));
  } finally {
    db.close();
  }
}

export async function load(): Promise<Job | null> {
  try {
    const db = await open();
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      return (await settle(store.get(KEY))) ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function clear(): Promise<void> {
  try {
    await settle(indexedDB.deleteDatabase(DATABASE));
  } catch {
    // Nothing saved, or nothing that can be.
  }
}
