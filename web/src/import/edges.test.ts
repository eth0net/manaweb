// `edges.csv` is the one fixture here nobody captured: our own format,
// written for what a row can say and a record cannot.

import { expect, test } from "bun:test";
import type { Owned } from "../collection/cards";
import { detect, MANAWEB } from "./formats";
import { header, read } from "./read";

const NOW = "2026-10-07T00:00:00.000Z";

const file = await Bun.file(
  new URL("./fixtures/edges.csv", import.meta.url),
).text();

const { stacks, skipped } = read(file, MANAWEB, NOW);

const by = (id: string): Owned | undefined =>
  stacks.find((one) => one.scryfallId.startsWith(id));

test("the file is read as our own format", () => {
  expect(detect(header(file))?.name).toBe("Manaweb");
});

test("every row a read can make nothing of says which and why", () => {
  expect(skipped).toEqual([
    { line: 6, reason: "0 is not a count" },
    { line: 7, reason: "-1 is not a count" },
    { line: 8, reason: "1.5 is not a count" },
    { line: 9, reason: "10001 is not a count" },
    { line: 10, reason: "unknown finish gilded" },
    { line: 13, reason: "no such print not-a-uuid" },
    { line: 14, reason: "no print" },
  ]);
});

// A row too short to name a print, and a blank one, are neither read nor
// reported: a file ends in a newline and that is not a complaint.
test("a row with nothing in it is not a skipped row", () => {
  expect(stacks).toHaveLength(21);
});

test("a quoted field spanning two lines is one note", () => {
  expect(by("28d3")?.note).toBe(
    'Shop said "mint", I say not.\nSleeved since, anyway.',
  );
});

test("a note a spreadsheet would evaluate is text like any other", () => {
  expect(by("6da6")?.note).toBe("=1+1 is penciled on the sleeve");
});

test("a tag list is trimmed, and an empty one is no tag", () => {
  expect(by("e2b8")?.tags).toEqual(["altered", "misprint", "signed"]);
});

test("a tag past the bytes a lexicon counts is cut to them", () => {
  const tag = by("0220")?.tags?.[0] ?? "";
  expect(new TextEncoder().encode(tag).length).toBeLessThanOrEqual(64);
});

test("a finish column left empty is not foil", () => {
  expect(by("0083")?.finish).toBe("nonfoil");
});

test("a grade nobody has a word for leaves the row ungraded", () => {
  expect(by("0131")?.condition).toBeUndefined();
  expect(by("006f")?.condition).toBe("lightPlayed");
});

test("a sum with no currency beside it is not a lot", () => {
  expect(by("4c2a")?.acquisitions).toBeUndefined();
  expect(by("0017")?.acquisitions).toEqual([
    { quantity: 1, price: "3.00", currency: "GBP" },
  ]);
});

test("a day with no clock on it is still a day", () => {
  expect(by("c47c")?.acquisitions).toEqual([
    { quantity: 1, at: "2025-04-01T00:00:00.000Z" },
  ]);
  expect(by("531e")?.acquisitions).toBeUndefined();
});

test("a year past what a lexicon takes is read as no date at all", () => {
  expect(by("0970")?.createdAt).toBe(NOW);
});

test("where a card was filed is written and read back as nothing", () => {
  expect(by("93de")?.container).toBeUndefined();
});

test("two rows of one stack are one record keeping the earlier date", () => {
  expect(by("513e")).toEqual({
    scryfallId: "513e063c-b328-4e5f-8806-b232c38645f5",
    finish: "nonfoil",
    quantity: 5,
    createdAt: "2023-01-01T00:00:00.000Z",
  });
});

test("the copies a lexicon will take at most are still a count", () => {
  expect(by("8bed")?.quantity).toBe(10000);
});
