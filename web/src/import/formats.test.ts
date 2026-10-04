import { expect, test } from "bun:test";
import { CONDITIONS } from "../collection/cards";
import {
  columns,
  detect,
  FORMATS,
  finish,
  flag,
  flagged,
  foil,
  grade,
  graded,
  key,
  MANABOX,
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
