import { expect, test } from "bun:test";
import {
  apply,
  type Change,
  fold,
  type Owned,
  type Stack,
  stack,
  then,
} from "./cards";

const copy: Owned = {
  scryfallId: "0000aaaa-0000-4000-8000-00000000000a",
  finish: "nonfoil",
  quantity: 1,
  createdAt: "2026-09-11T00:00:00.000Z",
};

const BOX = "at://did:plc:x/app.manaweb.container/box";
const SHELF = "at://did:plc:x/app.manaweb.container/shelf";
const NOW = "2026-09-12T00:00:00.000Z";
const JAN = "2026-01-01T00:00:00.000Z";
const MAR = "2026-03-01T00:00:00.000Z";
const JUN = "2026-06-01T00:00:00.000Z";

function stacks(...values: Owned[]): Stack[] {
  return values.map((value, at) => ({
    uri: `at://did:plc:x/app.manaweb.card/${at}`,
    cid: `cid${at}`,
    value,
  }));
}

test("a finish makes a separate stack", () => {
  expect(stack({ ...copy, finish: "foil" })).not.toBe(stack(copy));
});

test("a grade makes a separate stack", () => {
  expect(stack({ ...copy, condition: "played" })).not.toBe(stack(copy));
});

test("a proxy is not the same thing as a card", () => {
  expect(stack({ ...copy, proxy: true })).not.toBe(stack(copy));
});

test("what is said about the copies keeps them apart", () => {
  expect(stack({ ...copy, tags: ["signed"] })).not.toBe(stack(copy));
  expect(stack({ ...copy, note: "from dad" })).not.toBe(stack(copy));
});

test("the order tags were written in says nothing", () => {
  expect(stack({ ...copy, tags: ["signed", "altered"] })).toBe(
    stack({ ...copy, tags: ["altered", "signed"] }),
  );
});

test("the same printing in two places is two stacks", () => {
  expect(stack({ ...copy, container: BOX })).not.toBe(stack(copy));
});

test("an add matching every field increments rather than creating", () => {
  expect(
    stack({ ...copy, quantity: 7, createdAt: "2020-01-01T00:00:00.000Z" }),
  ).toBe(stack(copy));
});

test("the last copy taken deletes the record", () => {
  const [one] = stacks(copy) as [Stack];
  const change = apply([one], one.uri, { quantity: 0 }, NOW);

  expect(change.writes).toEqual([]);
  expect(change.drops).toEqual([one.uri]);
  expect(change.stacks).toEqual([]);
});

test("moving onto another stack's identity merges the two", () => {
  const [filed, loose] = stacks(
    { ...copy, quantity: 2, container: BOX },
    { ...copy, quantity: 3 },
  ) as [Stack, Stack];

  const change = apply(
    [filed, loose],
    filed.uri,
    { container: undefined },
    NOW,
  );

  expect(change.drops).toEqual([filed.uri]);
  expect(change.writes).toEqual([
    { uri: loose.uri, value: { ...copy, quantity: 5, updatedAt: NOW } },
  ]);
  expect(change.stacks).toHaveLength(1);
});

test("a merge keeps both histories and the older createdAt", () => {
  const [filed, loose] = stacks(
    {
      ...copy,
      quantity: 2,
      container: BOX,
      createdAt: "2020-01-01T00:00:00.000Z",
      acquisitions: [{ quantity: 2, price: "3.00", currency: "GBP" }],
    },
    { ...copy, acquisitions: [{ quantity: 1, price: "1.50" }] },
  ) as [Stack, Stack];

  const change = apply(
    [filed, loose],
    filed.uri,
    { container: undefined },
    NOW,
  );
  const merged = change.writes[0]?.value;

  expect(merged?.quantity).toBe(3);
  expect(merged?.acquisitions).toHaveLength(2);
  expect(merged?.createdAt).toBe("2020-01-01T00:00:00.000Z");
});

test("a merge the lexicon would refuse is not made", () => {
  const lots = Array.from({ length: 40 }, () => ({ quantity: 1 }));
  const [filed, loose] = stacks(
    { ...copy, container: BOX, acquisitions: lots },
    { ...copy, acquisitions: lots },
  ) as [Stack, Stack];

  const change = apply(
    [filed, loose],
    filed.uri,
    { container: undefined },
    NOW,
  );

  expect(change.drops).toEqual([]);
  expect(change.stacks).toHaveLength(2);
});

test("tags are written as the set they are", () => {
  const [one] = stacks(copy) as [Stack];
  const change = apply(
    [one],
    one.uri,
    { tags: ["signed", "altered", "signed"] },
    NOW,
  );

  expect(change.writes[0]?.value.tags).toEqual(["altered", "signed"]);
});

test("history reads in date order however the merge went", () => {
  const [filed, loose] = stacks(
    { ...copy, container: BOX, acquisitions: [{ quantity: 1, at: JAN }] },
    { ...copy, acquisitions: [{ quantity: 1 }, { quantity: 1, at: JUN }] },
  ) as [Stack, Stack];

  const change = apply(
    [filed, loose],
    filed.uri,
    { container: undefined },
    NOW,
  );

  // The undated lot can't be placed, so it leads and the rest is a sequence.
  expect(change.writes[0]?.value.acquisitions).toEqual([
    { quantity: 1 },
    { quantity: 1, at: JAN },
    { quantity: 1, at: JUN },
  ]);
});

test("undated lots keep the order they are already in", () => {
  // Enough of them to reach whatever the engine does past a short array.
  const undated = Array.from({ length: 16 }, (_, n) => ({ quantity: n + 1 }));
  const [one] = stacks({
    ...copy,
    acquisitions: [...undated, { quantity: 99, at: JAN }],
  }) as [Stack];

  const change = apply([one], one.uri, { quantity: 2 }, NOW);

  expect(change.writes[0]?.value.acquisitions).toEqual([
    ...undated,
    { quantity: 99, at: JAN },
  ]);
});

test("two containers emptied in either order leave one history", () => {
  const [first, second, loose] = stacks(
    { ...copy, container: BOX, acquisitions: [{ quantity: 1, at: JUN }] },
    { ...copy, container: SHELF, acquisitions: [{ quantity: 1, at: JAN }] },
    { ...copy, acquisitions: [{ quantity: 1, at: MAR }] },
  ) as [Stack, Stack, Stack];

  const held = [first, second, loose];
  const history = (order: Stack[]) => {
    let change: Change = { writes: [], drops: [], stacks: held };
    for (const one of order) {
      change = then(
        change,
        apply(change.stacks, one.uri, { container: undefined }, NOW),
      );
    }
    return change.stacks[0]?.value.acquisitions;
  };

  expect(history([first, second])).toEqual([
    { quantity: 1, at: JAN },
    { quantity: 1, at: MAR },
    { quantity: 1, at: JUN },
  ]);
  expect(history([second, first])).toEqual(history([first, second]));
});

test("a grade of its own stays its own stack", () => {
  const [filed, loose] = stacks(
    { ...copy, container: BOX },
    { ...copy, condition: "played" },
  ) as [Stack, Stack];

  const change = apply(
    [filed, loose],
    filed.uri,
    { container: undefined },
    NOW,
  );

  expect(change.drops).toEqual([]);
  expect(change.stacks).toHaveLength(2);
  expect(change.writes[0]?.value).not.toHaveProperty("container");
});

test("emptying a container folds every stack in it into one change", () => {
  const [first, second, loose] = stacks(
    { ...copy, quantity: 2, container: BOX },
    { ...copy, quantity: 1, condition: "played", container: BOX },
    { ...copy, quantity: 3 },
  ) as [Stack, Stack, Stack];

  let change: Change = {
    writes: [],
    drops: [],
    stacks: [first, second, loose],
  };
  for (const one of [first, second]) {
    change = then(
      change,
      apply(change.stacks, one.uri, { container: undefined }, NOW),
    );
  }

  // The ungraded copies join what was already loose; the played one can't.
  expect(change.drops).toEqual([first.uri]);
  expect(change.writes.map((one) => one.uri)).toEqual([loose.uri, second.uri]);
  expect(change.stacks).toHaveLength(2);
});

test("a record written then dropped is only dropped", () => {
  const [one] = stacks(copy) as [Stack];
  const change = then(
    { writes: [{ uri: one.uri, value: one.value }], drops: [], stacks: [one] },
    { writes: [], drops: [one.uri], stacks: [] },
  );

  expect(change.writes).toEqual([]);
  expect(change.drops).toEqual([one.uri]);
});

test("a read carries what landed while it was in flight", () => {
  const [first, second] = stacks(copy, { ...copy, finish: "foil" });
  const written = { ...(second as Stack), value: { ...copy, quantity: 9 } };
  const since = new Map([[written.uri, written]]);

  // The read answers with the repo as it was before that write.
  const folded = fold([first as Stack], since);
  expect(folded).toHaveLength(2);
  expect(folded[1]?.value.quantity).toBe(9);
});

test("a read that already has the record keeps the newer one", () => {
  const [one] = stacks(copy);
  const newer = { ...(one as Stack), value: { ...copy, quantity: 4 } };

  const folded = fold([one as Stack], new Map([[newer.uri, newer]]));
  expect(folded).toHaveLength(1);
  expect(folded[0]?.value.quantity).toBe(4);
});
