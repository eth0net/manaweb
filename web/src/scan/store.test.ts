import { afterEach, expect, test } from "bun:test";
import { broken, database } from "../testing/idb";
import type { Entry } from "./scratch";
import { forget, keep, keepGrade, recall, recallGrade } from "./store";

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
    condition: "nearMint",
    quantity: 1,
    ...over,
  };
}

test("nothing kept reads as nothing rather than as a failure", async () => {
  expect(await recall()).toBeNull();
});

test("a list survives being written and read back", async () => {
  await keep([one({ id: "a" }), one({ id: "b", quantity: 3 })]);

  const found = await recall();
  expect(found).toHaveLength(2);
  expect(found?.[1]).toMatchObject({ id: "b", quantity: 3 });
});

// A build before the stacks carried a grade, which is one object store and
// one version behind: the upgrade has to run on the way to reading it.
async function seed(list: Entry[], grade?: string): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const asked = indexedDB.open("manaweb-scan", 1);
    asked.onupgradeneeded = () => asked.result.createObjectStore("scratch");
    asked.onsuccess = () => resolve(asked.result);
    asked.onerror = () => reject(asked.error);
  });
  await new Promise<void>((resolve, reject) => {
    const held = db.transaction("scratch", "readwrite");
    held.objectStore("scratch").put(list, "list");
    if (grade !== undefined) held.objectStore("scratch").put(grade, "grade");
    held.oncomplete = () => resolve();
    held.onabort = () => reject(held.error);
  });
  db.close();
}

// What those stacks would have been written at, so the pile does not change
// grade underneath somebody on the strength of an upgrade.
test("stacks saved before they carried a grade take the list's", async () => {
  await seed([one({ condition: undefined as unknown as string })], "played");
  expect((await recall())?.[0]?.condition).toBe("played");
});

test("stacks saved under no grade at all take the usual one", async () => {
  await seed([one({ condition: undefined as unknown as string })]);
  expect((await recall())?.[0]?.condition).toBe("nearMint");
});

// Ungraded is a grade somebody picked, so it survives a reload as itself
// rather than being read as a stack that said nothing.
test("a stack set to ungraded comes back ungraded", async () => {
  await keep([one({ condition: "" })]);
  expect((await recall())?.[0]?.condition).toBe("");
});

test("a later write replaces the whole list", async () => {
  await keep([one({ id: "a" }), one({ id: "b" })]);
  await keep([one({ id: "c" })]);

  expect((await recall())?.map((held) => held.id)).toEqual(["c"]);
});

test("forget leaves nothing behind", async () => {
  await keep([one()]);
  await forget();
  expect(await recall()).toBeNull();
});

test("the grade a scan is taken at starts at the usual one", async () => {
  expect(await recallGrade()).toBe("nearMint");
});

test("the grade a scan is taken at survives being written and read", async () => {
  await keepGrade("lightPlayed");
  expect(await recallGrade()).toBe("lightPlayed");
});

// The whole point of moving it out of the list: a box scanned as played goes
// on being scanned as played once those cards have been kept.
test("the grade outlives the pile it was set over", async () => {
  await keepGrade("played");
  await keep([one()]);
  await forget();

  expect(await recallGrade()).toBe("played");
});

test("ungraded survives as the grade to scan at", async () => {
  await keepGrade("");
  expect(await recallGrade()).toBe("");
});

// Carried across rather than reset, the old key being the last thing anybody
// said about what they were scanning.
test("the grade a stored list followed seeds the one to scan at", async () => {
  await seed([one()], "excellent");
  expect(await recallGrade()).toBe("excellent");
});

// The read has to move it, not lean on it: it is stored beside the list, so
// keeping those cards takes it away and the next box goes in near mint.
test("a seeded grade survives the list it was seeded from", async () => {
  await seed([one()], "excellent");
  expect(await recallGrade()).toBe("excellent");
  await forget();

  expect(await recallGrade()).toBe("excellent");
});

// A tab left open on the version before the settings store existed. The
// request would otherwise sit there answering neither way, and a scan would
// go on filling a list nothing was writing down.
test("an upgrade another tab is holding off fails rather than waiting", async () => {
  const holding = await new Promise<IDBDatabase>((resolve, reject) => {
    const asked = indexedDB.open("manaweb-scan", 1);
    asked.onupgradeneeded = () => asked.result.createObjectStore("scratch");
    asked.onsuccess = () => resolve(asked.result);
    asked.onerror = () => reject(asked.error);
  });

  try {
    await expect(recall()).rejects.toThrow("Close it and reload");
  } finally {
    holding.close();
  }
});

// The distinction the review turned up: a read that failed and an empty list
// are not the same answer, because only one of them may be written over.
test("a read that cannot open the database throws rather than reading empty", () => {
  broken("no room");
  expect(recall()).rejects.toThrow("no room");
});

test("a write that cannot open the database throws", () => {
  broken("no room");
  expect(keep([one()])).rejects.toThrow("no room");
});
