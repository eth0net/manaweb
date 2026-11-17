import { expect, test } from "bun:test";
import { type Holdings, type Stack, worth } from "./cards";

const stack = (scryfallId: string, finish: string) =>
  ({ value: { scryfallId, finish } }) as unknown as Stack;

function holding(stacks: Stack[]): Holdings {
  const printings = [...new Set(stacks.map((one) => one.value.scryfallId))];
  return { printings, stacks } as unknown as Holdings;
}

// The two questions the setting picks between: which cards are held, and
// whether both ways of making one are.
test("a printing is worth one, or the finishes held of it", () => {
  const owning = holding([
    stack("a", "nonfoil"),
    stack("a", "foil"),
    stack("b", "nonfoil"),
  ]);

  expect(worth(owning, false)).toEqual(
    new Map([
      ["a", 1],
      ["b", 1],
    ]),
  );
  expect(worth(owning, true)).toEqual(
    new Map([
      ["a", 2],
      ["b", 1],
    ]),
  );
});

// Two stacks of one printing in one finish is two boxes, not two treatments.
test("the same finish held twice counts once", () => {
  const owning = holding([stack("a", "nonfoil"), stack("a", "nonfoil")]);

  expect(worth(owning, true)).toEqual(new Map([["a", 1]]));
});

test("nothing held comes to nothing either way", () => {
  expect(worth(null, true)).toEqual(new Map());
  expect(worth(null, false)).toEqual(new Map());
});
