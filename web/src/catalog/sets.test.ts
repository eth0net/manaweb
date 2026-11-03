import { expect, test } from "bun:test";
import type { SetRow } from "./index";
import { type Listed, label, narrow } from "./sets";

function listed(set: SetRow, printings = 1): Listed {
  return { set, printings };
}

const SETS: Listed[] = [
  listed(["lea", "Limited Edition Alpha", "core", "1993-08-05"]),
  listed(["c14", "Commander 2014", "commander", "2014-11-07"]),
  listed([
    "ddg",
    "Duel Decks: Knights vs. Dragons",
    "duel_deck",
    "2011-04-01",
  ]),
  listed(["puma", "Ultimate Box Topper", "masterpiece", "2018-12-07"]),
];

test("a filter matches the name", () => {
  expect(narrow(SETS, "knights").map(({ set }) => set[0])).toEqual(["ddg"]);
});

test("a filter matches the code", () => {
  expect(narrow(SETS, "lea").map(({ set }) => set[0])).toEqual(["lea"]);
});

test("an empty filter is every set", () => {
  expect(narrow(SETS, "   ")).toHaveLength(SETS.length);
});

test("one set is named and a handful is counted", () => {
  expect(label(SETS, [])).toBe("All sets");
  expect(label(SETS, ["c14"])).toBe("Commander 2014");
  expect(label(SETS, ["c14", "lea"])).toBe("2 sets");
  expect(label(SETS, ["zzz"])).toBe("ZZZ");
});
