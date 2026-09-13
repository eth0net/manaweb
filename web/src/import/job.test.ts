import { expect, test } from "bun:test";
import { BATCH } from "../oauth/repo";
import { SPACING } from "./job";

// The figure `docs/atproto.md` measured, which the pacing has to agree with or
// one of the two is wrong.
test("a ten thousand stack import takes about six hours", () => {
  const batches = Math.ceil(10_000 / BATCH);
  const hours = ((batches - 1) * SPACING) / 3_600_000;
  expect(hours).toBeGreaterThan(5.5);
  expect(hours).toBeLessThan(6.5);
});

test("an hour holds the creates a PDS allows", () => {
  const perHour = (3_600_000 / SPACING) * BATCH;
  expect(Math.round(perHour)).toBe(1666);
});
