// Records a PDS would take: every bound the lexicon states, held to here so
// a failing case is one that could actually be written.

import fc from "fast-check";
import {
  CONDITIONS,
  COPIES,
  LOTS,
  NOTE,
  type Owned,
  TAG,
  TAGS,
} from "../collection/cards";
import type { Acquisition } from "../lexicons/app/manaweb/card";

const bytes = (text: string) => new TextEncoder().encode(text).length;

const graphemes = (text: string) =>
  [...new Intl.Segmenter().segment(text)].length;

export const id = fc.uuid({ version: 4 });

export const finish = fc.constantFrom("nonfoil", "foil", "etched");

export const condition = fc.constantFrom(...CONDITIONS);

export const when = fc
  .date({
    min: new Date("2000-01-01T00:00:00.000Z"),
    max: new Date("2030-01-01T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((at) => at.toISOString());

export const money = fc
  .integer({ min: 0, max: 999999 })
  .map((pence) => (pence / 100).toFixed(2));

export const currency = fc.constantFrom("GBP", "USD", "EUR");

// A comma is what the column is joined on, so a tag holding one is the
// `unkept` case and gets a test of its own rather than a share of every run.
export const tag = fc
  .string({ unit: "grapheme-ascii", minLength: 1, maxLength: 24 })
  .map((one) => one.trim())
  .filter((one) => one.length > 0 && !one.includes(",") && bytes(one) <= TAG);

export const note = fc
  .string({ unit: "grapheme", maxLength: NOTE })
  .map((one) => one.trim())
  .filter((one) => one.length > 0 && bytes(one) <= 3000);

export const lot: fc.Arbitrary<Acquisition> = fc.record(
  {
    quantity: fc.integer({ min: 1, max: COPIES }),
    at: when,
    price: money,
    currency,
    marketValue: money,
    marketCurrency: currency,
  },
  { requiredKeys: ["quantity"] },
);

// A lot a file can put back whole, which is what the lossless runs need.
export const kept: fc.Arbitrary<Acquisition> = fc.record({
  quantity: fc.integer({ min: 1, max: COPIES }),
  at: when,
  price: money,
  currency,
  marketValue: money,
  marketCurrency: currency,
});

// The order `clean` leaves history in, which every record this client writes
// has been through: undated lots first, then by day.
function history(lots: Acquisition[]): Acquisition[] {
  const at = (one: Acquisition) =>
    one.at ? Date.parse(one.at) : Number.NEGATIVE_INFINITY;
  // Subtracting two undated lots gives NaN, and a sort wants an ordering.
  return [...lots].sort((one, other) => {
    const first = at(one);
    const second = at(other);
    return first === second ? 0 : first < second ? -1 : 1;
  });
}

export const container = fc
  .string({ unit: "grapheme-ascii", minLength: 1, maxLength: 8 })
  .map((key) => `at://did:plc:x/app.manaweb.container/${key.trim()}`)
  .filter(
    (uri) => uri.length > "at://did:plc:x/app.manaweb.container/".length,
  );

// `false` is a record no client writes: a flag column reads back as absent,
// and `stack` already treats the two as one thing.
export function owned(
  lots: fc.Arbitrary<Acquisition> = lot,
): fc.Arbitrary<Owned> {
  return fc.record(
    {
      scryfallId: id,
      finish,
      quantity: fc.integer({ min: 1, max: COPIES }),
      condition,
      container,
      proxy: fc.constant(true),
      note,
      tags: fc
        .uniqueArray(tag, { minLength: 1, maxLength: 4 })
        .map((all) => all.slice(0, TAGS).sort()),
      acquisitions: fc
        .array(lots, { minLength: 1, maxLength: LOTS })
        .map(history),
      createdAt: when,
      updatedAt: when,
    },
    { requiredKeys: ["scryfallId", "finish", "quantity", "createdAt"] },
  );
}

// Stacks of one printing each, so nothing a read collapses can hide a loss.
export function collection(
  lots: fc.Arbitrary<Acquisition> = lot,
): fc.Arbitrary<Owned[]> {
  return fc.uniqueArray(owned(lots), {
    selector: (one) => one.scryfallId,
    maxLength: 6,
  });
}

export { bytes, graphemes };
