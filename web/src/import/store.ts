import type { Step } from "./plan";
import type { Receipt } from "./receipt";

// An import as it stands, so a closed tab picks it up rather than starting
// over. Its own database: the catalog's is a cache anyone may clear, and half
// a written import is not.
const DATABASE = "manaweb-import";
const STORE = "job";

// Whose repo it is writing to, what it planned, and how much of it landed.
// `dueAt` is the instant a wait ends rather than its length, for the reason in
// `docs/architecture.md`; `pending` marks a call whose answer was never seen,
// which is the only thing a resume has to investigate.
export type Job = {
  did: string;
  steps: Step[];
  // Filed once the last card lands, so it outlives the tab that planned it.
  receipt?: Receipt;
  done: number;
  dueAt: number;
  pending: boolean;
  misses: number;
  paused: boolean;
};

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
    await settle(store.put(job, job.did));
  } finally {
    db.close();
  }
}

// Keyed by whose repo it writes to. One key for all of them let a second
// account's import destroy the first account's half-written one.
export async function load(did: string): Promise<Job | null> {
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

export async function clear(did: string): Promise<void> {
  try {
    const db = await open();
    try {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE);
      await settle(store.delete(did));
    } finally {
      db.close();
    }
  } catch {
    // Nothing saved, or nothing that can be.
  }
}
