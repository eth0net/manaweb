// What a dev build keeps back, so a read can be sent up once it is known to
// have gone wrong rather than before — `docs/scanner.md`.
//
// Reached only through a dynamic import inside `import.meta.env.DEV`, which
// is what keeps it, and the route it posts to, out of anything that deploys.

import { CAPTURE } from "./capture";

const DATABASE = "manaweb-frames";
const STORE = "frames";
const AT = "at";

// How many frames to hold, and how long. A phone backgrounds the tab between
// scanning and looking, so these outlive the page; a megabyte or two each is
// why there are not many of them.
const MOST = 5;
const FOR = 60 * 60 * 1000;

type Kept = { id: string; at: number; png: Blob };

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function open(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore(STORE, { keyPath: "id" });
    store.createIndex(AT, AT);
  };
  return settle(request);
}

// The canvas as the bytes the engine read, which is what makes a capture
// worth scoring without photographing the card again.
export function snapshot(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((keep, refuse) => {
    canvas.toBlob((blob) => {
      if (blob) keep(blob);
      else refuse(new Error("The frame would not encode"));
    }, "image/png");
  });
}

export async function hold(id: string, png: Blob): Promise<void> {
  const db = await open();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.put({ id, at: Date.now(), png } satisfies Kept);
    await evict(store);
    await committed(transaction);
  } finally {
    db.close();
  }
}

export async function frame(id: string): Promise<Blob | null> {
  try {
    const db = await open();
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      return ((await settle(store.get(id))) as Kept | undefined)?.png ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

// Keys rather than values, so deciding what to drop never reads a blob.
// Requests run in the order they are made, so the count below is taken after
// the stale ones have gone.
async function evict(store: IDBObjectStore): Promise<void> {
  const index = store.index(AT);
  const stale = await settle(
    index.getAllKeys(IDBKeyRange.upperBound(Date.now() - FOR)),
  );
  for (const key of stale) store.delete(key);

  const left = await settle(index.getAllKeys());
  for (const key of left.slice(0, Math.max(0, left.length - MOST))) {
    store.delete(key);
  }
}

// The frame, the note, and what a person said it actually was. Posted only
// when asked for: nothing here goes up because a scan happened.
export async function report(
  png: Blob,
  note: Record<string, unknown>,
): Promise<void> {
  const answered = await fetch(CAPTURE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note, png: await encoded(png) }),
  });
  if (!answered.ok) {
    throw new Error(`The report was refused: ${answered.status}`);
  }
}

// Base64, so one request carries the frame and the note together. A reader
// encodes it without script walking a megabyte of array.
function encoded(png: Blob): Promise<string> {
  return new Promise((keep, refuse) => {
    const reader = new FileReader();
    reader.onerror = () => refuse(new Error("The frame would not encode"));
    reader.onload = () => {
      const read = String(reader.result);
      keep(read.slice(read.indexOf(",") + 1));
    };
    reader.readAsDataURL(png);
  });
}
