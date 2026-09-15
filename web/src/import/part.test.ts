import { expect, test } from "bun:test";
import { landing, type Owned, type Stack, shown } from "../collection/cards";
import { BYTES, type Held } from "../oauth/repo";
import { drain, index, owed, PART, pack } from "./part";
import type { Receipt } from "./receipt";

const NOW = "2026-09-15T00:00:00.000Z";
const JAN = "2026-01-01T00:00:00.000Z";
const DID = "did:plc:x";

const copy: Owned = {
  scryfallId: "0000aaaa-0000-4000-8000-00000000000a",
  finish: "nonfoil",
  quantity: 1,
  createdAt: JAN,
};

const of: Receipt = { digest: "sha256-x", createdAt: NOW };

function many(count: number): Owned[] {
  return Array.from({ length: count }, (_, at) => ({
    ...copy,
    scryfallId: `${at}`.padStart(8, "0"),
  }));
}

function part(value: Receipt): Held<Receipt> {
  return { uri: `at://${DID}/app.manaweb.import/p1`, cid: "c1", value };
}

function stacks(...values: Owned[]): Stack[] {
  return values.map((value, at) => ({
    uri: `at://${DID}/app.manaweb.card/held${at}`,
    cid: `cid${at}`,
    value,
  }));
}

test("a file is cut into parts a drain can carry whole", () => {
  const parts = pack(many(PART * 2 + 1), of);
  expect(parts.map((one) => one.entries?.length)).toEqual([PART, PART, 1]);
  expect(parts.every((one) => one.digest === of.digest)).toBe(true);
});

test("stacks at their ceilings cut a part short of its count", () => {
  const fat = {
    note: "x".repeat(3000),
    tags: Array.from({ length: 32 }, (_, at) => `tag${at}`.padEnd(64, "x")),
    acquisitions: Array.from({ length: 64 }, () => ({
      quantity: 1,
      at: JAN,
      price: "1.00",
      currency: "GBP",
      marketValue: "1.00",
      marketCurrency: "GBP",
    })),
  };

  const parts = pack(
    many(PART).map((one) => ({ ...one, ...fat })),
    of,
  );

  expect(parts.length).toBeGreaterThan(1);
  for (const one of parts) {
    expect(JSON.stringify(one).length).toBeLessThan(BYTES);
  }
});

test("a drain writes a card for every entry and retires the part", () => {
  const { writes } = drain(
    part({ ...of, entries: many(3) }),
    new Map(),
    DID,
    NOW,
  );
  expect(writes).toHaveLength(4);
  expect(writes.filter((one) => one.action === "create")).toHaveLength(3);
  expect(writes.at(-1)).toEqual({
    action: "delete",
    collection: "app.manaweb.import",
    rkey: "p1",
  });
});

test("an entry matching a card held joins it rather than starting one", () => {
  const held = stacks({ ...copy, quantity: 2 });
  const { writes, landed } = drain(
    part({ ...of, entries: [{ ...copy, quantity: 3 }] }),
    index(held),
    DID,
    NOW,
  );

  expect(writes[0]).toMatchObject({ action: "update", rkey: "held0" });
  expect(landed[0]?.value.quantity).toBe(5);
  expect(landed[0]?.uri).toBe(held[0]?.uri);
});

// Joining is decided against the collection, not against the file, so a part
// written weeks earlier lands on whatever is there when it drains.
test("what an entry joins is decided when it drains, not when it packs", () => {
  const entries = [copy];
  const alone = drain(part({ ...of, entries }), new Map(), DID, NOW);
  const onto = drain(part({ ...of, entries }), index(stacks(copy)), DID, NOW);

  expect(alone.writes[0]?.action).toBe("create");
  expect(onto.writes[0]?.action).toBe("update");
});

test("two entries of one stack become one record", () => {
  const { writes } = drain(
    part({ ...of, entries: [copy, copy] }),
    new Map(),
    DID,
    NOW,
  );
  expect(writes.filter((one) => one.action === "create")).toHaveLength(1);
  expect(writes.filter((one) => one.action === "update")).toHaveLength(1);
});

test("what is owed is what the repo still holds", () => {
  expect(owed([part({ ...of, entries: many(7) }), part(of)])).toBe(7);
});

test("a card written a moment ago is what the next part joins", () => {
  const fresh = stacks({ ...copy, quantity: 4 })[0];
  if (!fresh) throw new Error("no stack");

  const { writes } = drain(
    part({ ...of, entries: [copy] }),
    index([], [fresh]),
    DID,
    NOW,
  );
  expect(writes[0]).toMatchObject({ action: "update", rkey: "held0" });
});

function flat(parts: Held<Receipt>[]): Owned[] {
  return parts.flatMap((one) => (one.value.entries ?? []) as Owned[]);
}

function count(stacks: Stack[]): number {
  return stacks.reduce((sum, one) => sum + shown(one), 0);
}

// The number a person reads as their collection. It is wrong for it to dip
// while an import turns into records, and a drain is where it would.
test("the total holds from the upload landing to the last part drained", () => {
  const file = many(500).map((one, at) => ({
    ...one,
    quantity: (at % 3) + 1,
  }));
  // The same stack twice, which is what two parts merging into one record is.
  const twice = [...file, ...file.slice(0, 120)];
  const total = twice.reduce((sum, one) => sum + one.quantity, 0);

  let left = pack(twice, of).map((value, at) => ({
    uri: `at://${DID}/app.manaweb.import/p${at}`,
    cid: `c${at}`,
    value,
  }));
  let records: Stack[] = [];

  expect(left.length).toBeGreaterThan(1);
  expect(count(landing(records, flat(left)))).toBe(total);

  let drains = 0;
  while (left.length > 0) {
    const [one, ...rest] = left;
    if (!one) break;

    const { landed } = drain(one, index(records), DID, NOW);
    const by = new Map(records.map((held) => [held.uri, held]));
    for (const made of landed) by.set(made.uri, made);

    records = [...by.values()];
    left = rest;
    drains += 1;
    expect(count(landing(records, flat(left)))).toBe(total);
  }

  expect(drains).toBe(pack(twice, of).length);
  expect(count(records)).toBe(total);
});
