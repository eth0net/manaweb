import { expect, test } from "bun:test";
import fc from "fast-check";
import { lot, owned, when } from "../testing/owned";
import {
  COPIES,
  earlier,
  joins,
  LOTS,
  later,
  merge,
  type Owned,
  stack,
} from "./cards";

const RUNS = { numRuns: 500 };

const held = (one: Owned) => (one.acquisitions ?? []).length;

const sorted = (one: Owned) =>
  (one.acquisitions ?? []).map((held) => JSON.stringify(held)).sort();

// Two stacks of one identity, which is the only pair `joins` can answer for.
const pair = fc
  .tuple(
    owned(),
    fc.integer({ min: 1, max: COPIES }),
    fc.array(lot, { maxLength: LOTS }),
    when,
    fc.option(when, { nil: undefined }),
  )
  .map(([one, quantity, acquisitions, createdAt, updatedAt]) => {
    const other: Owned = {
      ...one,
      quantity,
      createdAt,
      updatedAt,
      acquisitions: acquisitions.length > 0 ? acquisitions : undefined,
    };
    return [one, other] as const;
  });

test("a merge of two stacks is a stack of the same thing", () => {
  fc.assert(
    fc.property(pair, ([one, other]) => {
      fc.pre(joins(one, other));
      expect(stack(merge(one, other))).toBe(stack(one));
    }),
    RUNS,
  );
});

test("a merge holds every copy and every lot, and neither ceiling moves", () => {
  fc.assert(
    fc.property(pair, ([one, other]) => {
      fc.pre(joins(one, other));
      const both = merge(one, other);

      expect(both.quantity).toBe(one.quantity + other.quantity);
      expect(both.quantity).toBeLessThanOrEqual(COPIES);
      expect(held(both)).toBe(held(one) + held(other));
      expect(held(both)).toBeLessThanOrEqual(LOTS);
    }),
    RUNS,
  );
});

test("which stack is merged into which decides neither count nor history", () => {
  fc.assert(
    fc.property(pair, ([one, other]) => {
      fc.pre(joins(one, other));

      expect(merge(other, one).quantity).toBe(merge(one, other).quantity);
      expect(sorted(merge(other, one))).toEqual(sorted(merge(one, other)));
    }),
    RUNS,
  );
});

test("a merge begins when the earlier did and changes when the later did", () => {
  fc.assert(
    fc.property(pair, ([one, other]) => {
      fc.pre(joins(one, other));
      const both = merge(one, other);

      expect(both.createdAt).toBe(earlier(one.createdAt, other.createdAt));
      expect(both.updatedAt).toBe(later(one.updatedAt, other.updatedAt));
    }),
    RUNS,
  );
});

test("a merge told when it happened takes that and neither date it held", () => {
  fc.assert(
    fc.property(pair, when, ([one, other], at) => {
      fc.pre(joins(one, other));
      expect(merge(one, other, at).updatedAt).toBe(at);
    }),
    RUNS,
  );
});

test("joining is a question about a pair, not about an order", () => {
  fc.assert(
    fc.property(pair, ([one, other]) => {
      expect(joins(other, one)).toBe(joins(one, other));
    }),
    RUNS,
  );
});

test("a stack refuses itself only at a ceiling", () => {
  fc.assert(
    fc.property(owned(), (one) => {
      expect(joins(one, one)).toBe(
        one.quantity * 2 <= COPIES && held(one) * 2 <= LOTS,
      );
    }),
    RUNS,
  );
});

test("the order tags were written in is not part of what they say", () => {
  fc.assert(
    fc.property(owned(), fc.nat(), (one, turn) => {
      const tags = [...(one.tags ?? [])];
      fc.pre(tags.length > 0);
      const spun = tags.map(
        (_, at) => tags[(at + turn) % tags.length] as string,
      );
      expect(stack({ ...one, tags: spun })).toBe(stack(one));
    }),
    RUNS,
  );
});
