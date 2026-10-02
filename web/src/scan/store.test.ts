import { afterEach, expect, test } from "bun:test";
import { broken, database } from "../testing/idb";
import type { Entry } from "./scratch";
import { forget, keep, recall } from "./store";

// A fresh database per test: these all write the one key.
afterEach(() => void database());
database();

function one(over: Partial<Entry> = {}): Entry {
  return {
    id: "a",
    at: "2026-09-29T00:00:00.000Z",
    margin: 8,
    detected: true,
    matched: [{ distance: 0, prints: ["p1"] }],
    scryfallId: "p1",
    finish: "nonfoil",
    quantity: 1,
    ...over,
  };
}

test("nothing kept reads as nothing rather than as a failure", async () => {
  expect(await recall()).toBeNull();
});

test("a list survives being written and read back", async () => {
  const list = [one({ id: "a" }), one({ id: "b", quantity: 3 })];
  await keep({ list, grade: "played" });

  const found = await recall();
  expect(found?.list).toHaveLength(2);
  expect(found?.list[1]).toMatchObject({ id: "b", quantity: 3 });
  expect(found?.grade).toBe("played");
});

// The list outlives the tab and the grade governs what it is written as, so
// one of them coming back without the other writes a grade nobody chose.
test("the grade comes back with the list it was set over", async () => {
  await keep({ list: [one()], grade: "lightPlayed" });
  expect((await recall())?.grade).toBe("lightPlayed");
});

// The list on its own, under the key the store uses, which is what a build
// from before the grade existed left behind.
async function seed(list: Entry[]): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const asked = indexedDB.open("manaweb-scan", 1);
    asked.onupgradeneeded = () => asked.result.createObjectStore("scratch");
    asked.onsuccess = () => resolve(asked.result);
    asked.onerror = () => reject(asked.error);
  });
  await new Promise<void>((resolve, reject) => {
    const held = db.transaction("scratch", "readwrite");
    held.objectStore("scratch").put(list, "list");
    held.oncomplete = () => resolve();
    held.onabort = () => reject(held.error);
  });
  db.close();
}

// Which is not a list graded at nothing: it was scanned under a build that
// wrote no condition at all.
test("a list stored without a grade reads back at the usual one", async () => {
  await seed([one()]);
  expect((await recall())?.grade).toBe("nearMint");
});

// Ungraded is a grade somebody picked, so it has to survive a reload as
// itself rather than falling back to the one a blank means.
test("a list set to ungraded comes back ungraded", async () => {
  await keep({ list: [one()], grade: "" });
  expect((await recall())?.grade).toBe("");
});

test("a later write replaces the whole list", async () => {
  await keep({ list: [one({ id: "a" }), one({ id: "b" })], grade: "" });
  await keep({ list: [one({ id: "c" })], grade: "" });

  expect((await recall())?.list.map((held) => held.id)).toEqual(["c"]);
});

test("forget leaves nothing behind", async () => {
  await keep({ list: [one()], grade: "mint" });
  await forget();
  expect(await recall()).toBeNull();

  // The grade too, which `keep` would hide: it writes both keys, so only a
  // list put back on its own can show what forget left behind.
  await seed([one()]);
  expect((await recall())?.grade).toBe("nearMint");
});

// The distinction the review turned up: a read that failed and an empty list
// are not the same answer, because only one of them may be written over.
test("a read that cannot open the database throws rather than reading empty", () => {
  broken("no room");
  expect(recall()).rejects.toThrow("no room");
});

test("a write that cannot open the database throws", () => {
  broken("no room");
  expect(keep({ list: [one()], grade: "" })).rejects.toThrow("no room");
});
