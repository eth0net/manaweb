import { expect, test } from "bun:test";
import type { Owned, Stack } from "../collection/cards";
import { plan, weigh } from "./plan";

const NOW = "2026-09-13T00:00:00.000Z";
const JAN = "2026-01-01T00:00:00.000Z";

const copy: Owned = {
  scryfallId: "0000aaaa-0000-4000-8000-00000000000a",
  finish: "nonfoil",
  quantity: 1,
  createdAt: JAN,
};

function stacks(...values: Owned[]): Stack[] {
  return values.map((value, at) => ({
    uri: `at://did:plc:x/app.manaweb.card/held${at}`,
    cid: `cid${at}`,
    value,
  }));
}

test("a stack nothing matches is a new record", () => {
  const steps = plan([copy], [], NOW);
  expect(steps).toHaveLength(1);
  expect(steps[0]?.held).toBe(false);
  expect(steps[0]?.value.quantity).toBe(1);
});

test("a stack matching one already held joins it", () => {
  const steps = plan([{ ...copy, quantity: 3 }], stacks(copy), NOW);
  expect(steps).toEqual([
    {
      rkey: "held0",
      held: true,
      value: { ...copy, quantity: 4, updatedAt: NOW },
    },
  ]);
});

test("a stack differing in grade is its own record", () => {
  const steps = plan([{ ...copy, condition: "played" }], stacks(copy), NOW);
  expect(steps[0]?.held).toBe(false);
});

test("the earlier beginning survives a join", () => {
  const steps = plan(
    [{ ...copy, createdAt: "2025-01-01T00:00:00.000Z" }],
    stacks(copy),
    NOW,
  );
  expect(steps[0]?.value.createdAt).toBe("2025-01-01T00:00:00.000Z");
});

test("both histories survive a join", () => {
  const lot = { quantity: 1, marketValue: "0.18", marketCurrency: "GBP" };
  const steps = plan(
    [{ ...copy, acquisitions: [lot] }],
    stacks({ ...copy, acquisitions: [lot] }),
    NOW,
  );
  expect(steps[0]?.value.acquisitions).toHaveLength(2);
});

test("a join crossing the copy ceiling leaves a second record", () => {
  const steps = plan(
    [{ ...copy, quantity: 9000 }],
    stacks({ ...copy, quantity: 9000 }),
    NOW,
  );
  expect(steps[0]?.held).toBe(false);
  expect(steps[0]?.value.quantity).toBe(9000);
});

test("two stacks joining one held record are one write", () => {
  const steps = plan(
    [
      { ...copy, quantity: 2 },
      { ...copy, quantity: 3 },
    ],
    stacks(copy),
    NOW,
  );
  expect(steps).toHaveLength(1);
  expect(steps[0]?.value.quantity).toBe(6);
});

test("keys are ordered, so records land in the order they were read", () => {
  const other = { ...copy, finish: "foil" };
  const steps = plan([copy, other], [], NOW);
  const keys = steps.map((one) => one.rkey);
  expect(keys).toEqual([...keys].sort());
  expect(new Set(keys).size).toBe(2);
});

test("a file arriving on an empty collection weighs itself", () => {
  const steps = plan([{ ...copy, quantity: 4 }], [], NOW);
  expect(weigh(steps, [])).toEqual({
    records: 1,
    fresh: 1,
    joined: 0,
    adding: 4,
    before: 0,
    after: 4,
  });
});

test("a joining stack adds the file's copies, not the merged total", () => {
  const held = stacks({ ...copy, quantity: 1 });
  const steps = plan([{ ...copy, quantity: 3 }], held, NOW);
  const weight = weigh(steps, held);
  expect(weight.adding).toBe(3);
  expect(weight.before).toBe(1);
  expect(weight.after).toBe(4);
});

test("stacks the file never touches still count either side", () => {
  const held = stacks(copy, { ...copy, finish: "foil", quantity: 7 });
  const weight = weigh(plan([copy], held, NOW), held);
  expect(weight.before).toBe(8);
  expect(weight.after).toBe(9);
  expect(weight.joined).toBe(1);
});

test("a file already imported brings nothing new and doubles the count", () => {
  const first = plan([{ ...copy, quantity: 2 }], [], NOW);
  const held = first.map((one, at) => ({
    uri: `at://did:plc:x/app.manaweb.card/${one.rkey}`,
    cid: `cid${at}`,
    value: one.value,
  }));

  const weight = weigh(plan([{ ...copy, quantity: 2 }], held, NOW), held);
  expect(weight.fresh).toBe(0);
  expect(weight.after).toBe(weight.before * 2);
});
