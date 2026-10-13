import { expect, test } from "bun:test";
import { CONDITIONS } from "../collection/cards";
import {
  asPaid,
  columns,
  detect,
  FORMATS,
  type Format,
  finish,
  flag,
  flagged,
  foil,
  grade,
  graded,
  key,
  MANABOX,
  MANAWEB,
} from "./formats";

test("a header carrying every bound column names its format", () => {
  expect(detect(Object.values(MANABOX.binding))?.name).toBe("ManaBox");
});

test("a header short of one bound column names nothing", () => {
  const head = Object.values(MANABOX.binding).filter((one) => one !== "Foil");
  expect(detect(head)).toBeNull();
});

test("a header short of a column only an export fills still names it", () => {
  const head = Object.entries(MANABOX.binding)
    .filter(([field]) => field !== "rarity" && field !== "language")
    .map(([, column]) => column);
  expect(detect(head)?.name).toBe("ManaBox");
});

test("a column is matched on what it says, not how it was typed", () => {
  const head = Object.values(MANABOX.binding).map((one) => one.toUpperCase());
  expect(detect(head)?.name).toBe("ManaBox");
});

test("a grade is the lexicon's however it was written", () => {
  expect(grade("near_mint")).toBe("nearMint");
  expect(grade("Near Mint")).toBe("nearMint");
  expect(grade("NEARMINT")).toBe("nearMint");
  expect(grade("pristine")).toBeUndefined();
});

test("a finish is the record's spelling of it", () => {
  expect(finish("normal")).toBe("nonfoil");
  expect(finish("")).toBe("nonfoil");
  expect(finish("Etched")).toBe("etched");
  expect(finish("shiny")).toBeUndefined();
});

test("a flag is however a vendor writes yes", () => {
  expect(flag("true")).toBe(true);
  expect(flag("Yes")).toBe(true);
  expect(flag("false")).toBe(false);
  expect(flag("")).toBe(false);
});

test("a finish is written as the vendor spells it", () => {
  expect(foil("nonfoil")).toBe("normal");
  expect(foil("foil")).toBe("foil");
  expect(foil("etched")).toBe("etched");
  expect(foil("glossy")).toBeUndefined();
});

test("a grade is written back as the one it was read from", () => {
  for (const one of CONDITIONS) expect(grade(graded(one))).toBe(one);
  expect(graded("nearMint")).toBe("near_mint");
});

test("a flag is written as the vendor spells it", () => {
  expect(flag(flagged(true))).toBe(true);
  expect(flag(flagged(false))).toBe(false);
  expect(flagged(true)).toBe("true");
});

test("every column a format binds is one its export writes", () => {
  for (const format of FORMATS) {
    const written = new Set(columns(format).map(key));
    for (const column of Object.values(format.binding)) {
      expect(written).toContain(key(column));
    }
  }
});

test("reading a price as paid moves the column, not the file", () => {
  const paid = asPaid(MANABOX);

  expect(paid?.binding.price).toBe(MANABOX.binding.marketValue);
  expect(paid?.binding.currency).toBe(MANABOX.binding.marketCurrency);
  expect(paid?.binding.marketValue).toBeUndefined();
  expect(paid?.binding.marketCurrency).toBeUndefined();
  expect(columns(paid as Format)).toEqual(columns(MANABOX));
});

test("a format already saying what you paid has nothing to offer", () => {
  expect(asPaid(MANAWEB)).toBeNull();
});

// A currency already bound belongs to a price column this one is not, so
// rebinding would pair an amount with a code meant for another.
test("a currency already spoken for leaves the price column alone", () => {
  const odd: Format = {
    name: "Odd",
    binding: {
      scryfallId: "Scryfall ID",
      finish: "Foil",
      quantity: "Quantity",
      currency: "Paid in",
      marketValue: "Worth",
    },
  };
  expect(asPaid(odd)).toBeNull();
});
