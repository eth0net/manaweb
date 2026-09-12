import { expect, test } from "bun:test";
import { detect, finish, flag, grade, MANABOX } from "./formats";

test("a header carrying every bound column names its format", () => {
  expect(detect(Object.values(MANABOX.binding))?.name).toBe("ManaBox");
});

test("a header short of one bound column names nothing", () => {
  const head = Object.values(MANABOX.binding).filter((one) => one !== "Foil");
  expect(detect(head)).toBeNull();
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
