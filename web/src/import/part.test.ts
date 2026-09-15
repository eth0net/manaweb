import { expect, test } from "bun:test";
import type { Owned, Stack } from "../collection/cards";
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
