import { afterEach, expect, test } from "bun:test";
import { broken, database } from "../testing/idb";
import { type Entry, SCANNED, type Source } from "./scratch";
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
  expect(await recall("scan")).toBeNull();
});

test("a list survives being written and read back", async () => {
  await keep("scan", SCANNED, [
    one({ id: "a" }),
    one({ id: "b", quantity: 3 }),
  ]);

  const found = await recall("scan");
  expect(found?.list).toHaveLength(2);
  expect(found?.list[1]).toMatchObject({ id: "b", quantity: 3 });
});

// A build before the stacks carried a grade, which is one object store and
// one version behind: the upgrade has to run on the way to reading it.
async function seed(
  list: Entry[],
  grade?: string,
  source?: Source,
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const asked = indexedDB.open("manaweb-scan", 1);
    asked.onupgradeneeded = () => asked.result.createObjectStore("scratch");
    asked.onsuccess = () => resolve(asked.result);
    asked.onerror = () => reject(asked.error);
  });
  await new Promise<void>((resolve, reject) => {
    const held = db.transaction("scratch", "readwrite");
    held.objectStore("scratch").put(source ? { source, list } : list, "list");
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
  expect((await recall("scan"))?.list[0]?.condition).toBe("played");
});

test("stacks saved under no grade at all take the usual one", async () => {
  await seed([one({ condition: undefined as unknown as string })]);
  expect((await recall("scan"))?.list[0]?.condition).toBe("nearMint");
});

// Ungraded is a grade somebody picked, so it survives a reload as itself
// rather than being read as a stack that said nothing.
test("a stack set to ungraded comes back ungraded", async () => {
  await keep("scan", SCANNED, [one({ condition: "" })]);
  expect((await recall("scan"))?.list[0]?.condition).toBe("");
});

test("a later write replaces the whole list", async () => {
  await keep("scan", SCANNED, [one({ id: "a" }), one({ id: "b" })]);
  await keep("scan", SCANNED, [one({ id: "c" })]);

  expect((await recall("scan"))?.list.map((held) => held.id)).toEqual(["c"]);
});

// Nothing saved before the split was ever a file, and reading one as a file
// under review would put a line behind rows that have none.
test("a list saved before the split reads as a scan", async () => {
  await seed([one()]);
  expect((await recall("scan"))?.source).toEqual(SCANNED);
});

const READ = {
  at: "file" as const,
  format: "ManaBox",
  file: "binder.csv",
  digest: "sha256-abc",
};

test("what a list was read out of survives a write and a read", async () => {
  await keep("file", READ, [one({ line: 7 })]);

  const found = await recall("file");
  expect(found?.source).toEqual(READ);
  expect(found?.list[0]?.line).toBe(7);
});

// A box being worked through and a file being gone through are two piles,
// and neither may take the other's place.
test("a scan and an import are kept apart", async () => {
  await keep("scan", SCANNED, [one({ id: "a" })]);
  await keep("file", READ, [one({ id: "b" }), one({ id: "c" })]);

  expect((await recall("scan"))?.list.map((held) => held.id)).toEqual(["a"]);
  expect((await recall("file"))?.list.map((held) => held.id)).toEqual([
    "b",
    "c",
  ]);

  await forget("file");
  expect((await recall("scan"))?.list).toHaveLength(1);
  expect(await recall("file")).toBeNull();
});

// A device that saved a file under the one key there used to be: those rows
// are the import's, and the camera must not find them.
test("a file saved before the split moves to the import", async () => {
  await seed([one({ line: 7 })], undefined, READ);

  expect((await recall("file"))?.list[0]?.line).toBe(7);
  expect(await recall("scan")).toBeNull();
  // Moved rather than copied, or clearing the import would bring it back.
  expect(await recall("file")).not.toBeNull();
  await forget("file");
  expect(await recall("file")).toBeNull();
});

// The camera reads first as often as not: both hooks mount together, so the
// one key has to answer for whose list it holds rather than for being there.
test("the camera does not take the list a file left behind", async () => {
  await seed([one({ line: 7 })], undefined, READ);

  expect(await recall("scan")).toBeNull();
  expect((await recall("file"))?.list[0]?.line).toBe(7);
});

test("read at once, each flow still gets its own", async () => {
  await seed([one({ line: 7 })], undefined, READ);

  const [scan, file] = await Promise.all([recall("scan"), recall("file")]);
  expect(scan).toBeNull();
  expect(file?.list[0]?.line).toBe(7);
});

// The other direction: a bare list from before any of this was a scan, and
// the import may not claim it.
test("the import does not take a list saved by the camera", async () => {
  await seed([one({ id: "a" })]);

  expect(await recall("file")).toBeNull();
  expect((await recall("scan"))?.list).toHaveLength(1);
});

test("forget leaves nothing behind", async () => {
  await keep("scan", SCANNED, [one()]);
  await forget("scan");
  expect(await recall("scan")).toBeNull();
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
  await keep("scan", SCANNED, [one()]);
  await forget("scan");

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
  await forget("scan");

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
    await expect(recall("scan")).rejects.toThrow("Close it and reload");
  } finally {
    holding.close();
  }
});

// The distinction the review turned up: a read that failed and an empty list
// are not the same answer, because only one of them may be written over.
test("a read that cannot open the database throws rather than reading empty", async () => {
  broken("no room");
  await expect(recall("scan")).rejects.toThrow("no room");
});

test("a write that cannot open the database throws", async () => {
  broken("no room");
  await expect(keep("scan", SCANNED, [one()])).rejects.toThrow("no room");
});
