import { expect, test } from "bun:test";
import { BATCH, BYTES, POINTS } from "../oauth/repo";
import { PART } from "./part";
import { HOURLY } from "./runner";

// The figures `docs/atproto.md` measured, which the quote has to agree with or
// one of the two is wrong.
const DRAIN = PART * POINTS.create + POINTS.delete;

test("eight drains fit in an hour and a ninth does not", () => {
  expect(DRAIN * 8).toBeLessThanOrEqual(5000);
  expect(DRAIN * 9).toBeGreaterThan(5000);
});

test("an hour carries the cards those eight hold", () => {
  expect(HOURLY).toBe(1592);
});

test("a ten thousand stack import is quoted at about six hours", () => {
  expect(10_000 / HOURLY).toBeGreaterThan(5.5);
  expect(10_000 / HOURLY).toBeLessThan(6.5);
});

// A full part of the largest stack the lexicon allows must not exceed the body
// limit, or the part has to be cut by bytes rather than by count.
test("a part of the fattest stacks would not fit in one body", () => {
  const fat = 3000 + 32 * 64 + 64 * 120;
  expect(PART * fat).toBeGreaterThan(BYTES);
});

test("a part leaves room for the write that retires it", () => {
  expect(PART).toBeLessThan(BATCH);
});
