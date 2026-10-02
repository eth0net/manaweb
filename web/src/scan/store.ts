import { useCallback, useEffect, useRef, useState } from "react";
import type { Entry } from "./scratch";

// Where a scratch list is kept, and the hook that keeps it. The browser's
// own rather than an account's: a run of scanning is one device holding one
// pile, and nothing is owed to a repo until somebody keeps it.
const DATABASE = "manaweb-scan";
const STORE = "scratch";
const LIST = "list";
const GRADE = "grade";

// What a list starts out graded at — `docs/scanner.md`.
const USUALLY = "nearMint";

// The list and what it is graded at — `docs/scanner.md`.
export type Held = { list: Entry[]; grade: string };

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
export async function recall(): Promise<Held | null> {
  const db = await open();
  try {
    // Both asked before either is awaited: a transaction goes inactive at
    // the first await, and a second request on it then throws.
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const asking = settle<Entry[] | undefined>(store.get(LIST));
    const graded = settle<string | undefined>(store.get(GRADE));
    const [list, grade] = await Promise.all([asking, graded]);
    return list ? { list, grade: grade ?? USUALLY } : null;
  } finally {
    db.close();
  }
}

// Throws where the catalog's cache resolves: a scan nothing wrote down is a
// card somebody has to find and photograph again.
export async function keep(held: Held): Promise<void> {
  const db = await open();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.put(held.list, LIST);
    store.put(held.grade, GRADE);
    await committed(transaction);
  } finally {
    db.close();
  }
}

export async function forget(): Promise<void> {
  const db = await open();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.delete(LIST);
    store.delete(GRADE);
    await committed(transaction);
  } finally {
    db.close();
  }
}

export type Scratch = {
  ready: boolean;
  list: Entry[];
  // What a stack saying nothing of its own is kept at, `""` being ungraded.
  grade: string;
  regrade: (grade: string) => void;
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
  const [grade, setGrade] = useState(USUALLY);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const held = useRef<Entry[]>([]);
  const mark = useRef(USUALLY);
  // Whether a grade was picked before the read answered, that one being the
  // later word on the same pile.
  const picked = useRef(false);
  // A read that never answered is one nothing may be written over.
  const sealed = useRef(false);

  // Optimistic: the list is what the page shows, and a store that refused it
  // is something to say rather than something to undo.
  const write = useCallback(() => {
    if (sealed.current) return;
    setProblem(null);
    keep({ list: held.current, grade: mark.current }).catch(
      (failed: unknown) =>
        setProblem(failed instanceof Error ? failed.message : String(failed)),
    );
  }, []);

  useEffect(() => {
    let live = true;
    recall()
      .then((found) => {
        if (!live || !found) return;
        // Behind whatever was scanned while the read was still going: those
        // cards were seen first, and neither list may take the other's place.
        const scanned = held.current;
        held.current = [...found.list, ...scanned];
        setList(held.current);
        if (!picked.current) {
          mark.current = found.grade;
          setGrade(found.grade);
        }
        // Such a scan has already stored itself over what was saved, so the
        // join has to go back down before the next reload reads it.
        if (scanned.length > 0) write();
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
  }, [write]);

  const change = useCallback(
    (move: (list: Entry[]) => Entry[]) => {
      held.current = move(held.current);
      setList(held.current);
      write();
    },
    [write],
  );

  const regrade = useCallback(
    (next: string) => {
      mark.current = next;
      picked.current = true;
      setGrade(next);
      write();
    },
    [write],
  );

  const clear = useCallback(async () => {
    held.current = [];
    mark.current = USUALLY;
    picked.current = false;
    setList([]);
    setGrade(USUALLY);
    if (sealed.current) return;
    setProblem(null);
    await forget();
  }, []);

  return { ready, list, grade, regrade, change, clear, problem };
}
