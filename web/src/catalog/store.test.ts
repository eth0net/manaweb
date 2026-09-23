import { afterEach, expect, test } from "bun:test";
import { MANIFEST, prune, read, write } from "./store";

// Enough IndexedDB to hold the store to its contract and no more. The one
// browser behavior these turn on is the order: a request succeeds, and the
// transaction carrying it settles afterwards — or aborts, which is what a
// quota does when it only bites at commit.
type Handler = (() => void) | null;

let held = new Map<string, ArrayBuffer>();
// Set to make every write transaction abort after its requests have succeeded.
let aborting = false;

function request<T>(result: T): { onsuccess: Handler; onerror: Handler } {
  const one = { onsuccess: null as Handler, onerror: null as Handler, result };
  queueMicrotask(() => one.onsuccess?.());
  return one;
}

function transaction() {
  const one = {
    oncomplete: null as Handler,
    onabort: null as Handler,
    onerror: null as Handler,
    error: aborting ? new Error("QuotaExceededError") : null,
    objectStore: () => store,
  };

  // After the requests, never with them: a write watching only its own
  // request would see success here and be wrong. A task rather than a
  // microtask, so a caller that awaits a request first is still listening.
  setTimeout(() => (aborting ? one.onabort?.() : one.oncomplete?.()), 0);
  return one;
}

const store = {
  put(bytes: ArrayBuffer, name: string) {
    if (!aborting) held.set(name, bytes);
    return request(undefined);
  },
  get: (name: string) => request(held.get(name)),
  getAllKeys: () => request([...held.keys()]),
  delete: (name: string) => {
    held.delete(name);
    return request(undefined);
  },
};

Object.defineProperty(globalThis, "indexedDB", {
  configurable: true,
  value: {
    open() {
      const one = {
        onsuccess: null as Handler,
        onerror: null as Handler,
        onupgradeneeded: null as Handler,
        result: { transaction, close() {}, createObjectStore() {} },
      };
      queueMicrotask(() => {
        one.onupgradeneeded?.();
        one.onsuccess?.();
      });
      return one;
    },
    deleteDatabase: () => request(undefined),
  },
});

function bytes(of: string): ArrayBuffer {
  return new TextEncoder().encode(of).buffer as ArrayBuffer;
}

afterEach(() => {
  held = new Map();
  aborting = false;
});

test("what is written reads back", async () => {
  expect(await write("cards.a.json", bytes("cards"))).toBe(true);
  expect(await read("cards.a.json")).not.toBeNull();
});

test("a name nothing wrote reads as nothing", async () => {
  expect(await read("cards.b.json")).toBeNull();
});

// The defect this guards: `onsuccess` fires before the transaction does, so a
// write watching the request alone reported storing what it never stored, and
// `load` cached a manifest naming a pair this device did not hold.
test("a write that aborts at commit says so", async () => {
  aborting = true;
  expect(await write("cards.c.json", bytes("cards"))).toBe(false);
  aborting = false;
  expect(await read("cards.c.json")).toBeNull();
});

test("a sweep keeps the pair the manifest names and the manifest", async () => {
  await write(MANIFEST, bytes("{}"));
  await write("cards.new.json", bytes("cards"));
  await write("cards.old.json", bytes("cards"));

  await prune(["cards.new.json"]);

  expect(await read("cards.new.json")).not.toBeNull();
  expect(await read(MANIFEST)).not.toBeNull();
  expect(await read("cards.old.json")).toBeNull();
});
