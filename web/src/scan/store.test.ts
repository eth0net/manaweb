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
  await keep(list);

  const found = await recall();
  expect(found).toHaveLength(2);
  expect(found?.[1]).toMatchObject({ id: "b", quantity: 3 });
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
