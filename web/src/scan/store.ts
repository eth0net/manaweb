import { useCallback, useEffect, useRef, useState } from "react";
import type { Entry } from "./scratch";

// Where a scratch list is kept, and the hook that keeps it. The browser's
// own rather than an account's: a run of scanning is one device holding one
// pile, and nothing is owed to a repo until somebody keeps it.
const DATABASE = "manaweb-scan";
const STORE = "scratch";
// Preferences outlive the pile they were set over, so they are not kept in
// the store a kept list empties — `docs/scanner.md`.
const SETTINGS = "settings";
const LIST = "list";
const GRADE = "grade";

// What a scan is graded at until somebody says otherwise — `docs/scanner.md`.
const USUALLY = "nearMint";

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

const BLOCKED =
  "Another tab has this open on an older version. Close it and reload.";

// Both stores named every time rather than only on the version that added
// one: an upgrade runs from whatever is on the device, including nothing.
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [STORE, SETTINGS])
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // A tab on the version before this one holds the upgrade off, and the
    // request then neither succeeds nor fails — so it is made to fail.
    request.onblocked = () => reject(new Error(BLOCKED));
  });
}

// Throws rather than answering null, because a read that failed and a list
// that is not there differ by everything: one of them must not be written
// over.
export async function recall(): Promise<Entry[] | null> {
  const db = await open();
  try {
    // Both asked before either is awaited: a transaction goes inactive at
    // the first await, and a second request on it then throws.
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const asking = settle<Entry[] | undefined>(store.get(LIST));
    const graded = settle<string | undefined>(store.get(GRADE));
    const [list, grade] = await Promise.all([asking, graded]);
    if (!list) return null;
    // A stack saved before it carried a grade of its own followed the list's,
    // so that is the one it was always going to be kept at.
    return list.map((one) => ({
      ...one,
      condition: one.condition ?? grade ?? USUALLY,
    }));
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

// Seeded from the grade the last list followed, so the split does not quietly
// reset what somebody was already part way through.
export async function recallGrade(): Promise<string> {
  const db = await open();
  try {
    const reading = db.transaction([SETTINGS, STORE], "readonly");
    const asking = settle<string | undefined>(
      reading.objectStore(SETTINGS).get(GRADE),
    );
    const was = settle<string | undefined>(
      reading.objectStore(STORE).get(GRADE),
    );
    const [grade, followed] = await Promise.all([asking, was]);
    if (grade !== undefined) return grade;
    if (followed === undefined) return USUALLY;
    // Written across rather than read again each time: it is stored beside
    // the list, so it would go the first time a pile is kept.
    const writing = db.transaction(SETTINGS, "readwrite");
    writing.objectStore(SETTINGS).put(followed, GRADE);
    await committed(writing);
    return followed;
  } finally {
    db.close();
  }
}

export async function keepGrade(grade: string): Promise<void> {
  const db = await open();
  try {
    const transaction = db.transaction(SETTINGS, "readwrite");
    transaction.objectStore(SETTINGS).put(grade, GRADE);
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
  // Every move in `scratch.ts` is the list in and another out, so this takes
  // one rather than a new list: two presses in a tick then compose.
  change: (move: (list: Entry[]) => Entry[]) => void;
  // For once the cards are somewhere better than here.
  clear: () => Promise<void>;
  problem: string | null;
};

// The grade a scan is stamped with, and the press that moves it.
export type Grading = {
  grade: string;
  regrade: (grade: string) => void;
};

const UNREAD =
  "The scanned cards saved here could not be read, so nothing new is being saved either. Reload the page.";

// Read once and written through, the store being the only other reader: a
// preference nobody else edits does not need watching.
export function useGrade(): Grading {
  const [grade, setGrade] = useState(USUALLY);
  // Whether a grade was picked before the read answered, that one being the
  // later word.
  const picked = useRef(false);

  useEffect(() => {
    let live = true;
    recallGrade()
      .then((found) => {
        if (live && !picked.current) setGrade(found);
      })
      // A preference that cannot be read is one to carry on without, the
      // cards being what the store is there for.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const regrade = useCallback((next: string) => {
    picked.current = true;
    setGrade(next);
    void keepGrade(next).catch(() => {});
  }, []);

  return { grade, regrade };
}

export function useScratch(): Scratch {
  const [list, setList] = useState<Entry[]>([]);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const held = useRef<Entry[]>([]);
  // Whether what was stored has been taken. The effect runs again on a hot
  // reload with the ref still holding every card, and the join below would
  // then put the stored copy in front of the same cards a second time.
  const joined = useRef(false);
  // A read that never answered is one nothing may be written over.
  const sealed = useRef(false);

  // Optimistic: the list is what the page shows, and a store that refused it
  // is something to say rather than something to undo.
  const write = useCallback(() => {
    if (sealed.current) return;
    setProblem(null);
    keep(held.current).catch((failed: unknown) =>
      setProblem(failed instanceof Error ? failed.message : String(failed)),
    );
  }, []);

  useEffect(() => {
    let live = true;
    recall()
      .then((found) => {
        // Set before the empty case returns: a scan landing after a read that
        // found nothing is already in the ref, and the next read finds it.
        if (!live || joined.current) return;
        joined.current = true;
        if (!found) return;
        // Behind whatever was scanned while the read was still going: those
        // cards were seen first, and neither list may take the other's place.
        const scanned = held.current;
        held.current = [...found, ...scanned];
        setList(held.current);
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

  const clear = useCallback(async () => {
    held.current = [];
    setList([]);
    if (sealed.current) return;
    setProblem(null);
    await forget();
  }, []);

  return { ready, list, change, clear, problem };
}
