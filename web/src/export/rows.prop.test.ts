import { expect, test } from "bun:test";
import fc from "fast-check";
import { COPIES, type Owned, type Stack, shown } from "../collection/cards";
import { type Field, type Format, MANABOX, MANAWEB } from "../import/formats";
import { read } from "../import/read";
import type { Acquisition } from "../lexicons/app/manaweb/card";
import { collection, kept, owned } from "../testing/owned";
import { write } from "./csv";
import { type Describe, rows } from "./rows";

const RUNS = { numRuns: 300 };
const NOW = "2026-10-07T00:00:00.000Z";

// Every printing named, so `unnamed` and `refused` are out of the way and
// what is left to account for is what the record said.
const names: Describe = (ids) =>
  new Map(
    [...ids].map((id) => [
      id,
      {
        card: { name: `Card ${id.slice(0, 8)}` },
        print: {
          set: id.slice(0, 3),
          setName: `Set ${id.slice(0, 3)}`,
          collectorNumber: id.slice(9, 13),
          rarity: "rare",
          lang: "en",
        },
      },
    ]),
  );

const shelf = (all: Owned[]): Stack[] =>
  all.map((value, at) => ({ uri: `at://x/${at}`, cid: "", value }));

const places = (all: Owned[]) =>
  new Map(
    all.flatMap((one) =>
      one.container ? [[one.container, "Somewhere"] as const] : [],
    ),
  );

const order = (all: Owned[]) =>
  [...all].sort((one, other) =>
    one.scryfallId.localeCompare(other.scryfallId),
  );

function trip(all: Owned[], format: Format) {
  const written = rows(shelf(all), format, names, { places: places(all) });
  const back = read(write(written.rows), format, NOW).stacks;
  return { written, back };
}

// Lots a file has room for. A file is rows of copies, so `split` caps history
// at the copies held and a stack whose lots over-run its count loses the
// overrun — which is a loss about the stack, not about the format.
const fitting = collection(kept).map((all) =>
  all.map((one) => {
    const lots: Acquisition[] = [];
    let sum = 0;
    for (const held of one.acquisitions ?? []) {
      if (sum + held.quantity > COPIES) break;
      lots.push(held);
      sum += held.quantity;
    }
    return {
      ...one,
      quantity: Math.max(one.quantity, sum),
      acquisitions: lots.length > 0 ? lots : undefined,
    };
  }),
);

test("a file our own format loses nothing to puts every record back", () => {
  fc.assert(
    fc.property(fitting, (all) => {
      const loose = all.map(({ container: _, ...rest }) => rest as Owned);
      const { written, back } = trip(loose, MANAWEB);

      expect(written.dropped).toEqual([]);
      expect(written.unread).toEqual([]);
      expect(written.unkept).toBe(0);
      expect(written.unspelled).toBe(0);
      expect(order(back)).toEqual(order(loose));
    }),
    RUNS,
  );
});

test("where a card is filed is the one thing our own file cannot restore", () => {
  fc.assert(
    fc.property(fitting, (all) => {
      fc.pre(all.some((one) => one.container !== undefined));
      const { written, back } = trip(all, MANAWEB);

      expect(written.unread).toEqual(["container"]);
      expect(order(back)).toEqual(
        order(all).map(({ container: _, ...rest }) => rest as Owned),
      );
    }),
    RUNS,
  );
});

// The counters are computed from the stacks and the format without looking at
// the file, so holding the trip to them is not asking the code to agree with
// itself.
const FIELDS: [Field, (one: Owned) => unknown][] = [
  ["container", (one) => one.container],
  ["note", (one) => one.note],
  ["proxy", (one) => one.proxy],
  ["condition", (one) => one.condition],
  ["createdAt", (one) => one.createdAt],
  ["updatedAt", (one) => one.updatedAt],
  ["tags", (one) => one.tags],
];

test("whatever a file loses, the export named it first", () => {
  fc.assert(
    fc.property(fitting, fc.constantFrom(MANABOX, MANAWEB), (all, format) => {
      const { written, back } = trip(all, format);
      const named = new Set<Field>([...written.dropped, ...written.unread]);
      // Nothing these records say is a thing a row makes less of, so a
      // difference has to be a column the format has not got.
      expect(written.unkept).toBe(0);

      for (const one of order(all)) {
        const other = back.find((held) => held.scryfallId === one.scryfallId);
        if (!other) continue;
        for (const [field, said] of FIELDS) {
          if (Bun.deepEquals(said(one), said(other))) continue;
          expect([field, named.has(field)]).toEqual([field, true]);
        }
      }
    }),
    RUNS,
  );
});

test("a lot that comes back changed is a lot the export named", () => {
  fc.assert(
    fc.property(fitting, fc.constantFrom(MANABOX, MANAWEB), (all, format) => {
      const { written, back } = trip(all, format);
      const named = new Set<Field>([...written.dropped, ...written.unread]);
      expect(written.unkept).toBe(0);

      for (const one of all) {
        const other = back.find((held) => held.scryfallId === one.scryfallId);
        if (!other) continue;
        // A read builds a lot field by field, so `at` lands last: the two
        // are compared as objects rather than as the text of them.
        if (Bun.deepEquals(one.acquisitions ?? [], other.acquisitions ?? [])) {
          continue;
        }

        expect(
          named.has("price") ||
            named.has("marketValue") ||
            named.has("acquiredAt"),
        ).toBe(true);
      }
    }),
    RUNS,
  );
});

test("every copy comes back but the ones in a finish nobody can spell", () => {
  fc.assert(
    fc.property(fitting, fc.constantFrom(MANABOX, MANAWEB), (all, format) => {
      const { written, back } = trip(all, format);
      const copies = (held: Owned[]) =>
        held.reduce((sum, one) => sum + one.quantity, 0);

      expect(copies(back) + written.unspelled).toBe(copies(all));
    }),
    RUNS,
  );
});

// A format is a binding, so one built in the browser can leave out whatever
// its reader has no column for.
const narrowed: fc.Arbitrary<Format> = fc
  .subarray(
    Object.keys(MANAWEB.binding).filter(
      (field) => !["scryfallId", "finish", "quantity"].includes(field),
    ) as Field[],
  )
  .map((left) => ({
    name: "Narrow",
    binding: Object.fromEntries(
      Object.entries(MANAWEB.binding).filter(
        ([field]) =>
          !left.includes(field as Field) ||
          ["scryfallId", "finish", "quantity"].includes(field),
      ),
    ),
  }));

test("a format with no proxy column says so of a card that is one", () => {
  fc.assert(
    fc.property(owned(kept), narrowed, (one, format) => {
      fc.pre(one.proxy === true);
      fc.pre(format.binding.proxy === undefined);
      expect(rows(shelf([one]), format, names).dropped).toContain("proxy");
    }),
    RUNS,
  );
});

// What a record filling each field looks like, written from the record's
// side rather than the export's, so the two have to agree about it.
const FILLS: [Field, (one: Owned) => boolean][] = [
  ["container", (one) => one.container !== undefined],
  ["note", (one) => one.note !== undefined],
  ["proxy", (one) => one.proxy === true],
  ["condition", (one) => one.condition !== undefined],
  ["price", (one) => (one.acquisitions ?? []).some((lot) => "price" in lot)],
  [
    "currency",
    (one) => (one.acquisitions ?? []).some((lot) => "currency" in lot),
  ],
  [
    "marketValue",
    (one) => (one.acquisitions ?? []).some((lot) => "marketValue" in lot),
  ],
  [
    "marketCurrency",
    (one) => (one.acquisitions ?? []).some((lot) => "marketCurrency" in lot),
  ],
  ["acquiredAt", (one) => (one.acquisitions ?? []).some((lot) => "at" in lot)],
  ["createdAt", () => true],
  ["updatedAt", (one) => one.updatedAt !== undefined],
];

// Both shipped formats bind all of these, so a binding built in the browser
// is the only thing that reaches most of them.
test("a format names every field it has no column for", () => {
  fc.assert(
    fc.property(owned(kept), narrowed, (one, format) => {
      const named = new Set(rows(shelf([one]), format, names).dropped);

      for (const [field, fills] of FILLS) {
        if (!fills(one) || format.binding[field] !== undefined) continue;
        expect([field, named.has(field)]).toEqual([field, true]);
      }
    }),
    RUNS,
  );
});

// A lexicon refuses it, so no record carries one and only a generator gets
// here — `split` must still spend none of the copies on it.
test("a lot counting no copies spends none of them", () => {
  fc.assert(
    fc.property(owned(kept), fc.integer({ min: 1, max: 50 }), (one, extra) => {
      const empty: Owned = {
        ...one,
        quantity: extra,
        acquisitions: [{ quantity: 0 }, ...(one.acquisitions ?? [])],
      };
      const { rows: out } = rows(shelf([empty]), MANAWEB, names);
      const at = Object.values(MANAWEB.binding).indexOf("Quantity");
      const counted = out
        .slice(1)
        .reduce((sum, row) => sum + Number(row[at]), 0);

      expect(counted).toBe(shown({ uri: "", cid: "", value: empty }));
    }),
    RUNS,
  );
});
