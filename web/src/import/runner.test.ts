import { expect, test } from "bun:test";
import { BATCH, BYTES, POINTS } from "../oauth/repo";
import { HOURLY } from "./runner";

// The figures `docs/atproto.md` measured, which the quote has to agree with or
// one of the two is wrong.
test("an hour holds the creates a PDS allows", () => {
  expect(HOURLY).toBe(1666);
});

test("a ten thousand stack import is quoted at about six hours", () => {
  expect(10_000 / HOURLY).toBeGreaterThan(5.5);
  expect(10_000 / HOURLY).toBeLessThan(6.5);
});

// A full batch of the largest stack the lexicon allows must not exceed the
// body limit, or the batch has to be cut by bytes rather than by count.
test("a batch of the fattest stacks would not fit in one body", () => {
  const fat = 3000 + 32 * 64 + 64 * 120;
  expect(BATCH * fat).toBeGreaterThan(BYTES);
});

test("a full batch of creates costs a third of the hour", () => {
  expect(BATCH * POINTS.create).toBe(600);
});
