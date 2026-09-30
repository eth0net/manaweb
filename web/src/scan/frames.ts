// What a dev build keeps back, so a read can be sent up once it is known to
// have gone wrong rather than before — `docs/scanner.md`.
//
// Reached only through a dynamic import inside `import.meta.env.DEV`, which
// is what keeps it, and the route it posts to, out of anything that deploys.

import { CAPTURE } from "./capture";
import type { Entry } from "./scratch";

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

// What a person said the card was. Absent where nobody said, for the reason
// in `docs/scanner.md`.
export type Said = {
  print: string;
  label: string;
  finish: string;
  // Whether the index returned it at all.
  matched: boolean;
};

// What the reader made of a frame. Null where nothing in it looked like a
// card, which is its own kind of wrong and worth sending.
export type Read = {
  at: string;
  margin: number;
  detected: boolean;
  matched: Entry["matched"];
  said: string;
};

export type Told = {
  read: Read | null;
  answer: Said | null;
  // The person's own words, landing as `wrong` beside the reader's own
  // `read.said` — `docs/scanner.md`.
  wrong: string;
};

// One frame and everything said about it, keyed by the read rather than by
// any stack it made — `docs/scanner.md`.
export async function send(id: string, told: Told): Promise<void> {
  const png = await frame(id);
  if (!png) throw new Error("That frame is no longer held");

  const answered = await fetch(CAPTURE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      png: await encoded(png),
      note: {
        at: new Date().toISOString(),
        agent: navigator.userAgent,
        wrong: told.wrong,
        answer: told.answer,
        read: told.read,
      },
    }),
  });
  if (!answered.ok) {
    throw new Error(`The report was refused: ${answered.status}`);
  }
}

// What a stack's own read was, for reporting one from the review.
export function reading(one: Entry): Read {
  return {
    at: one.at,
    margin: one.margin,
    detected: one.detected,
    matched: one.matched,
    said: one.matched[0]?.prints[0] ?? one.scryfallId,
  };
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
