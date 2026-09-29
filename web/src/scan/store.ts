import { useCallback, useEffect, useRef, useState } from "react";
import type { Entry } from "./scratch";

// Where a scratch list is kept, and the hook that keeps it. The browser's
// own rather than an account's: a run of scanning is one device holding one
// pile, and nothing is owed to a repo until somebody keeps it.
const DATABASE = "manaweb-scan";
const STORE = "scratch";
const LIST = "list";

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

function open(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE);
  };
  return settle(request);
}

// Throws rather than answering null, because a read that failed and a list
// that is not there differ by everything: one of them must not be written
// over.
export async function recall(): Promise<Entry[] | null> {
  const db = await open();
  try {
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    return (await settle(store.get(LIST))) ?? null;
  } finally {
    db.close();
  }
}

// Throws where the catalog's cache resolves: a scan nothing wrote down is a
// card somebody has to find and photograph again.
export async function keep(list: Entry[]): Promise<void> {
  const db = await open();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(list, LIST);
    await committed(transaction);
  } finally {
    db.close();
  }
}

export async function forget(): Promise<void> {
  const db = await open();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(LIST);
    await committed(transaction);
  } finally {
    db.close();
  }
}

export type Scratch = {
  ready: boolean;
  list: Entry[];
  // Every move in `scratch.ts` is the list in and another out, so this takes
  // one rather than a new list: two presses in a tick then compose.
  change: (move: (list: Entry[]) => Entry[]) => void;
  // For once the cards are somewhere better than here.
  clear: () => Promise<void>;
  problem: string | null;
};

const UNREAD =
  "The scanned cards saved here could not be read, so nothing new is being saved either. Reload the page.";

export function useScratch(): Scratch {
  const [list, setList] = useState<Entry[]>([]);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const held = useRef<Entry[]>([]);
  // A read that never answered is one nothing may be written over.
  const sealed = useRef(false);

  useEffect(() => {
    let live = true;
    recall()
      .then((found) => {
        if (!live || !found?.length) return;
        // Behind whatever was scanned while the read was still going: those
        // cards were seen first, and neither list may take the other's place.
        held.current = [...found, ...held.current];
        setList(held.current);
      })
      .catch(() => {
        if (!live) return;
        sealed.current = true;
        setProblem(UNREAD);
      })
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const change = useCallback((move: (list: Entry[]) => Entry[]) => {
    const next = move(held.current);
    held.current = next;
    setList(next);
    if (sealed.current) return;
    setProblem(null);
    keep(next).catch((failed: unknown) =>
      setProblem(failed instanceof Error ? failed.message : String(failed)),
    );
  }, []);

  const clear = useCallback(async () => {
    held.current = [];
    setList([]);
    if (sealed.current) return;
    setProblem(null);
    await forget();
  }, []);

  return { ready, list, change, clear, problem };
}
