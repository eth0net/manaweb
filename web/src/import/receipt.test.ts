import { expect, test } from "bun:test";
import type { Owned } from "../collection/cards";
import { digest } from "./receipt";

const JAN = "2026-01-01T00:00:00.000Z";

const copy: Owned = {
  scryfallId: "0000aaaa-0000-4000-8000-00000000000a",
  finish: "nonfoil",
  quantity: 1,
  createdAt: JAN,
};

const other = { ...copy, finish: "foil" };

test("the same cards in another order are the same file", async () => {
  expect(await digest([copy, other])).toBe(await digest([other, copy]));
});

test("a file exported later is still the same file", async () => {
  const again = { ...copy, createdAt: "2026-06-01T00:00:00.000Z" };
  expect(await digest([again])).toBe(await digest([copy]));
});

test("a copy more is another file", async () => {
  expect(await digest([{ ...copy, quantity: 2 }])).not.toBe(
    await digest([copy]),
  );
});

test("a card more is another file", async () => {
  expect(await digest([copy, other])).not.toBe(await digest([copy]));
});

test("the algorithm is named, so a later one cannot match by accident", async () => {
  expect(await digest([copy])).toMatch(/^sha256-[0-9a-f]{64}$/);
});
