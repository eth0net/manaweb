import { expect, test } from "bun:test";
import type { Card, Print } from "../catalog";

// No hash differs by this much, which is what a lone match is measured by.
const APART = 65;

import type { Read } from "./read";
import {
  cards,
  choose,
  drop,
  type Entry,
  joinable,
  merged,
  minus,
  plus,
  refinish,
  scanned,
  settled,
  sure,
} from "./scratch";

// Enough of a printing for the list: an id and what it was made in.
function print(id: string, finishes: string[]): { card: Card; print: Print } {
  return {
    card: { name: id } as Card,
    print: { id, finishes } as Print,
  };
}

// Artworks two bits apart, so the read's own margin is the gap between the
// nearest two whether or not the catalog can name either.
function found(artworks: { card: Card; print: Print }[][]): Read {
  return {
    margin: artworks.length > 1 ? 2 : APART,
    detected: true,
    sure: false,
    found: artworks.map((prints, at) => ({
      artwork: at,
      distance: at * 2,
      prints,
    })),
  };
}

function one(over: Partial<Entry> = {}): Entry {
  return {
    id: "a",
    at: "2026-09-29T00:00:00.000Z",
    margin: 8,
    detected: true,
    matched: [{ distance: 0, prints: ["p1", "p2"] }],
    scryfallId: "p1",
    finish: "nonfoil",
    quantity: 1,
    ...over,
  };
}

test("a scan names the nearest printing and counts one of it", () => {
  const made = scanned(
    found([[print("p1", ["nonfoil", "foil"])], [print("p2", ["foil"])]]),
    "a",
    "2026-09-29T00:00:00.000Z",
  );

  expect(made?.scryfallId).toBe("p1");
  expect(made?.quantity).toBe(1);
  expect(made?.margin).toBe(2);
  expect(made?.matched).toEqual([
    { distance: 0, prints: ["p1"] },
    { distance: 2, prints: ["p2"] },
  ]);
});

test("an artwork no printing carries is not what a scan answers with", () => {
  const made = scanned(found([[], [print("p2", ["foil"])]]), "a", "now");
  expect(made?.scryfallId).toBe("p2");
  expect(made?.matched).toHaveLength(1);
});

test("a nearer artwork the catalog cannot name leaves nothing to be sure of", () => {
  // The read's own margin was measured against the artwork that was dropped,
  // so it says nothing about the printing the stack ends up holding.
  const made = scanned(found([[], [print("p2", ["foil"])]]), "a", "now");
  expect(made?.margin).toBe(0);
  expect(sure(made as Entry)).toBe(false);
});

test("the margin is the gap to the next artwork a printing carries", () => {
  const made = scanned(
    found([[print("p1", ["nonfoil"])], [], [print("p3", ["nonfoil"])]]),
    "a",
    "now",
  );
  // Artworks 0 and 2, four bits apart, rather than the read's 2.
  expect(made?.margin).toBe(4);
});

test("a scan matching no printing at all makes no stack", () => {
  expect(scanned(found([[], []]), "a", "now")).toBeNull();
});

test("the margin is what says whether to believe it", () => {
  expect(sure(one({ margin: 4 }))).toBe(true);
  expect(sure(one({ margin: 2 }))).toBe(false);
});

test("one finish settles itself and two start nonfoil", () => {
  expect(settled(["foil"])).toBe("foil");
  expect(settled(["nonfoil", "foil"])).toBe("nonfoil");
  expect(settled(["foil", "etched"])).toBe("foil");
  expect(settled([])).toBe("nonfoil");
});

test("a minus to zero takes the stack away", () => {
  const list = [one({ id: "a", quantity: 2 }), one({ id: "b" })];
  expect(minus(list, "a").map((held) => held.quantity)).toEqual([1, 1]);
  expect(minus(minus(list, "a"), "a").map((held) => held.id)).toEqual(["b"]);
});

test("a plus counts up and leaves the rest alone", () => {
  const list = [one({ id: "a" }), one({ id: "b" })];
  expect(plus(list, "b").map((held) => held.quantity)).toEqual([1, 2]);
});

test("drop takes one stack without touching another of the same card", () => {
  const list = [one({ id: "a" }), one({ id: "b" })];
  expect(drop(list, "a").map((held) => held.id)).toEqual(["b"]);
});

test("a printing is chosen out of what the scan matched, and no further", () => {
  const made = (id: string) => (id === "p2" ? ["foil"] : ["nonfoil", "foil"]);
  const list = [one()];

  expect(choose(list, "a", "p2", made)[0]).toMatchObject({
    scryfallId: "p2",
    finish: "foil",
  });
  expect(choose(list, "a", "p9", made)[0]?.scryfallId).toBe("p1");
});

test("pressing the printing already chosen leaves its finish alone", () => {
  const made = () => ["nonfoil", "foil"];
  const list = [one({ finish: "foil" })];
  expect(choose(list, "a", "p1", made)[0]?.finish).toBe("foil");
});

test("a finish the printing was never made in is refused", () => {
  const made = () => ["nonfoil", "foil"];
  expect(refinish([one()], "a", "foil", made)[0]?.finish).toBe("foil");
  expect(refinish([one()], "a", "etched", made)[0]?.finish).toBe("nonfoil");
});

test("scanning the same card twice makes two stacks until a merge", () => {
  const list = [
    one({ id: "a" }),
    one({ id: "b", scryfallId: "p2" }),
    one({ id: "c", quantity: 3 }),
  ];

  expect(joinable(list)).toBe(1);
  expect(merged(list).map((held) => [held.id, held.quantity])).toEqual([
    ["a", 4],
    ["b", 1],
  ]);
  expect(list[0]?.quantity).toBe(1);
});

test("a merge joins one finish and leaves the other", () => {
  const list = [one({ id: "a" }), one({ id: "b", finish: "foil" })];
  expect(joinable(list)).toBe(0);
});

test("a stack the ceiling closed does not stop the next one joining", () => {
  const list = [
    one({ id: "a", quantity: 5000 }),
    one({ id: "b", quantity: 6000 }),
    one({ id: "c", quantity: 5000 }),
  ];

  expect(joinable(list)).toBe(1);
  expect(merged(list).map((held) => held.quantity)).toEqual([10000, 6000]);
});

test("a plus stops at the ceiling", () => {
  const list = [one({ quantity: 10000 })];
  expect(plus(list, "a")[0]?.quantity).toBe(10000);
});

test("a merge keeps what the first of them was read as", () => {
  const list = [
    one({ id: "a", at: "first", detected: false, quantity: 1 }),
    one({ id: "b", at: "second", detected: true, quantity: 1 }),
  ];
  const [joined] = merged(list);

  expect(joined?.at).toBe("first");
  expect(joined?.detected).toBe(false);
  expect(joined?.quantity).toBe(2);
});

test("the list comes to cards a file would have named", () => {
  const list = [one({ id: "a", quantity: 2 })];

  expect(cards(list, null)).toEqual([
    {
      scryfallId: "p1",
      finish: "nonfoil",
      quantity: 2,
      createdAt: "2026-09-29T00:00:00.000Z",
    },
  ]);
  expect(cards(list, "binder")[0]?.container).toBe("binder");
});
