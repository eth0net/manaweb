// What a person has set, rather than what the scanner holds about a device —
// `docs/scanner.md` says which belongs where. Its own database because the
// scanner's sits beside the pile it was set over.

import { useCallback, useEffect, useSyncExternalStore } from "react";

const DATABASE = "manaweb-settings";
const STORE = "settings";

// Every preference, and what it is where nobody has said. The key is what the
// store holds it under, so renaming one forgets what was set.
const KEPT = {
  // Set completion counts the finishes a printing was made in, not the
  // printings — a larger denominator, and a preference rather than a fix.
  treatments: false as boolean,
};

export type Preference = keyof typeof KEPT;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function recall(key: Preference): Promise<unknown> {
  const db = await open();
  try {
    const asking = db
      .transaction(STORE, "readonly")
      .objectStore(STORE)
      .get(key);
    return await new Promise<unknown>((resolve, reject) => {
      asking.onsuccess = () => resolve(asking.result);
      asking.onerror = () => reject(asking.error);
    });
  } finally {
    db.close();
  }
}

export async function keep(key: Preference, on: unknown): Promise<void> {
  const db = await open();
  try {
    const writing = db.transaction(STORE, "readwrite");
    writing.objectStore(STORE).put(on, key);
    await new Promise<void>((resolve, reject) => {
      writing.oncomplete = () => resolve();
      writing.onabort = () => reject(writing.error);
      writing.onerror = () => reject(writing.error);
    });
  } finally {
    db.close();
  }
}

export type Setting<T> = {
  held: T;
  change: (next: T) => void;
};

// One answer per key for the whole page. Two screens reading the same
// preference are reading the same thing, so a copy apiece would leave
// whichever did not change it showing what it was.
const held = new Map<Preference, unknown>();
const watching = new Set<() => void>();
const asked = new Set<Preference>();

function announce(): void {
  for (const tell of watching) tell();
}

function watch(tell: () => void): () => void {
  watching.add(tell);
  return () => {
    watching.delete(tell);
  };
}

// Stored under the key this build no longer keeps there: a preference whose
// shape changed is worth less than the default it falls back to.
function fits(key: Preference, found: unknown): boolean {
  return typeof found === typeof KEPT[key];
}

// The stored value, unless something has been set since: a change made while
// the read was in flight is the later word.
function settle(key: Preference, found: unknown): void {
  if (found === undefined || held.has(key) || !fits(key, found)) return;
  held.set(key, found);
  announce();
}

// Set without the store behind it, and marked read so the store does not
// answer over the top. For a test that wants a screen already set one way.
export function preset<K extends Preference>(
  key: K,
  value: (typeof KEPT)[K],
): void {
  asked.add(key);
  held.set(key, value);
  announce();
}

// Back to knowing nothing, including that it has read. One process holds
// these for every test in a file, so one test's change is the next one's
// starting point without this.
export function forget(): void {
  held.clear();
  asked.clear();
  announce();
}

export function usePreference<K extends Preference>(
  key: K,
): Setting<(typeof KEPT)[K]> {
  type Value = (typeof KEPT)[K];
  const now = useSyncExternalStore(
    watch,
    () => (held.get(key) ?? KEPT[key]) as Value,
    () => KEPT[key],
  );

  useEffect(() => {
    if (asked.has(key)) return;
    asked.add(key);
    // A preference that cannot be read is one to carry on without.
    recall(key)
      .then((found) => settle(key, found))
      .catch(() => {});
  }, [key]);

  const change = useCallback(
    (next: Value) => {
      held.set(key, next);
      announce();
      void keep(key, next).catch(() => {});
    },
    [key],
  );

  return { held: now, change };
}
