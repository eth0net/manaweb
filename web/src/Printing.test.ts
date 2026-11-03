import { expect, test } from "bun:test";
import type { Print } from "./catalog";

// The module reads the app's language as it loads and bun's navigator names
// none, so the tag goes in before the import rather than after it.
Object.defineProperty(navigator, "language", { value: "en" });
const { brief, describe: full } = await import("./Printing");

function print(over: Partial<Print> = {}): Print {
  return {
    set: "msh",
    setName: "Marvel Super Heroes",
    setKind: "expansion",
    collectorNumber: "121",
    rarity: "uncommon",
    artist: "Alexander Gering",
    flags: [],
    ...over,
  } as Print;
}

test("a row names the set by its code and the rarity by a letter", () => {
  expect(brief(print())).toBe("MSH #121 · U");
});

test("the long form is left alone for telling printings apart", () => {
  expect(full(print())).toBe(
    "Marvel Super Heroes · MSH #121 · uncommon · Alexander Gering",
  );
});

// A code says which set; what kind of thing it was says where to look for a
// copy, and an expansion is the answer nobody needed.
test("a printing from a product says which kind it was", () => {
  expect(full(print({ setKind: "duel_deck" }))).toContain("· duel deck ·");
  expect(full(print({ setKind: "masterpiece" }))).toContain("· masterpiece ·");
  expect(full(print({ setKind: "expansion" }))).not.toContain("expansion");
  expect(full(print({ setKind: "core" }))).not.toContain("core");
});

test("every rarity Scryfall writes takes a letter of its own", () => {
  const letters = [
    "common",
    "uncommon",
    "rare",
    "mythic",
    "special",
    "bonus",
  ].map((rarity) => brief(print({ rarity })).split(" · ")[1]);
  expect(letters).toEqual(["C", "U", "R", "M", "S", "B"]);
  expect(new Set(letters).size).toBe(letters.length);
});

// A rarity nobody wrote down still has to render, the catalog carrying
// whatever Scryfall last said.
test("a rarity nothing here knows still takes its first letter", () => {
  expect(brief(print({ rarity: "masterpiece" }))).toBe("MSH #121 · M");
});

test("what makes a copy unusual stays on the row", () => {
  expect(brief(print({ flags: ["promo", "fullArt"] }))).toBe(
    "MSH #121 · U · promo · full art",
  );
});
