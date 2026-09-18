import { expect, test } from "bun:test";
import {
  landing,
  type Owned,
  type Stack,
  shown,
  stack,
} from "../collection/cards";
import { BYTES, type Held, type Result } from "../oauth/repo";
import { drain, index, landed, owed, PART, pack, without } from "./part";
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

// A second stack, to prove a removal leaves everything it did not name alone.
const other: Owned = { ...copy, finish: "foil" };

function many(count: number): Owned[] {
  return Array.from({ length: count }, (_, at) => ({
    ...copy,
    scryfallId: `${at}`.padStart(8, "0"),
  }));
}

function part(value: Receipt): Held<Receipt> {
  return { uri: `at://${DID}/app.manaweb.import/p1`, cid: "c1", value };
}

// What a PDS answers with: its own keys, one per write, in order. The counter
// spans calls, because one repo never hands out a key twice.
let minted = 0;

function answered(writes: { action: string; rkey?: string }[]): Result[] {
  return writes.map((one) => {
    if (one.action === "delete") return {};
    const key = one.rkey ?? `server${minted++}`;
    return { uri: `at://${DID}/app.manaweb.card/${key}`, cid: `cid-${key}` };
  });
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
  const writes = drain(part({ ...of, entries: many(3) }), new Map(), NOW);
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
  const writes = drain(
    part({ ...of, entries: [{ ...copy, quantity: 3 }] }),
    index(held),
    NOW,
  );

  expect(writes[0]).toMatchObject({ action: "update", rkey: "held0" });
  const wrote = landed(writes, answered(writes));
  expect(wrote[0]?.value.quantity).toBe(5);
});

// Two devices draining at once would otherwise write the same key twice.
test("a create leaves the key to the server", () => {
  const writes = drain(part({ ...of, entries: many(2) }), new Map(), NOW);
  const made = writes.filter((one) => one.action === "create");
  expect(made).toHaveLength(2);
  expect(made.every((one) => !("rkey" in one) || !one.rkey)).toBe(true);
});

test("what landed is addressed by the answer, not by the plan", () => {
  const writes = drain(part({ ...of, entries: many(2) }), new Map(), NOW);
  const wrote = landed(writes, answered(writes));

  expect(wrote).toHaveLength(2);
  expect(wrote[0]?.uri).toMatch(/app\.manaweb\.card\/server\d+$/);
  expect(wrote[1]?.uri).not.toBe(wrote[0]?.uri);
});

test("the part's own delete is not a card that landed", () => {
  const writes = drain(part({ ...of, entries: many(3) }), new Map(), NOW);
  expect(landed(writes, answered(writes))).toHaveLength(3);
});

// Joining is decided against the collection, not against the file, so a part
// written weeks earlier lands on whatever is there when it drains.
test("what an entry joins is decided when it drains, not when it packs", () => {
  const entries = [copy];
  const alone = drain(part({ ...of, entries }), new Map(), NOW);
  const onto = drain(part({ ...of, entries }), index(stacks(copy)), NOW);

  expect(alone[0]?.action).toBe("create");
  expect(onto[0]?.action).toBe("update");
});

test("two entries of one stack become one record", () => {
  const writes = drain(part({ ...of, entries: [copy, copy] }), new Map(), NOW);
  expect(writes.filter((one) => one.action === "create")).toHaveLength(1);
  expect(writes.filter((one) => one.action === "update")).toHaveLength(0);
  expect((writes[0] as { value: Owned }).value.quantity).toBe(2);
});

test("what is owed is what the repo still holds", () => {
  expect(owed([part({ ...of, entries: many(7) }), part(of)])).toBe(7);
});

test("a card written a moment ago is what the next part joins", () => {
  const fresh = stacks({ ...copy, quantity: 4 })[0];
  if (!fresh) throw new Error("no stack");

  const writes = drain(
    part({ ...of, entries: [copy] }),
    index([], [fresh]),
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

    const writes = drain(one, index(records), NOW);
    const by = new Map(records.map((held) => [held.uri, held]));
    for (const made of landed(writes, answered(writes)))
      by.set(made.uri, made);

    records = [...by.values()];
    left = rest;
    drains += 1;
    expect(count(landing(records, flat(left)))).toBe(total);
  }

  expect(drains).toBe(pack(twice, of).length);
  expect(count(records)).toBe(total);
});

function parts(...each: Owned[][]): Held<Receipt>[] {
  return each.map((entries, at) => ({
    uri: `at://${DID}/app.manaweb.import/p${at}`,
    cid: `c${at}`,
    value: { ...of, entries },
  }));
}

const key = stack(copy);

// `owed` counts entries; these tests are about the copies inside them.
function copies(held: Held<Receipt>[]): number {
  return held.reduce(
    (sum, one) =>
      sum +
      ((one.value.entries ?? []) as Owned[]).reduce(
        (n, e) => n + e.quantity,
        0,
      ),
    0,
  );
}

test("a copy taken off a stack leaves the rest of the part alone", () => {
  const { writes, left } = without(
    parts([{ ...copy, quantity: 3 }, other]),
    key,
    1,
  );

  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ action: "update", rkey: "p0" });
  expect(copies(left)).toBe(3);
  expect(left[0]?.value.entries?.[0]?.quantity).toBe(2);
});

test("taking every copy drops the entry", () => {
  const { left } = without(parts([{ ...copy, quantity: 2 }, other]), key, 2);
  expect(copies(left)).toBe(1);
  expect(left[0]?.value.entries).toEqual([other]);
});

// Entries of one stack can sit in different parts, so the removal walks them.
test("copies are taken across as many parts as hold them", () => {
  const { writes, left } = without(
    parts([{ ...copy, quantity: 2 }], [{ ...copy, quantity: 2 }]),
    key,
    3,
  );

  expect(writes).toHaveLength(2);
  expect(copies(left)).toBe(1);
});

test("a part emptied of everything is dropped rather than left saying nothing", () => {
  const { writes, left } = without(parts([copy]), key, 1);
  expect(writes).toEqual([
    { action: "delete", collection: "app.manaweb.import", rkey: "p0" },
  ]);
  expect(left).toHaveLength(0);
});

test("a stack no part holds is no write at all", () => {
  const { writes, left } = without(parts([other]), key, 1);
  expect(writes).toHaveLength(0);
  expect(copies(left)).toBe(1);
});

test("asking for more copies than are there takes what is there", () => {
  const { left } = without(parts([{ ...copy, quantity: 2 }]), key, 9);
  expect(copies(left)).toBe(0);
});
