import { describe, expect, test } from "bun:test";
import type { Card } from "../catalog/index";
import { bits, matches, parse } from "../catalog/query";
import { KEY, write } from "../terms";
import { LETTERS } from "./Colors";

const bolt = { colors: bits("R"), colorIdentity: bits("R") } as Card;
const sol = { colors: 0, colorIdentity: 0 } as Card;
const faceless = { colors: null, colorIdentity: bits("UR") } as Card;

describe("refusing a color", () => {
  test("each stands alone, so two of them is neither", () => {
    expect(
      write("bolt", KEY.colors, ["r", "g"], {
        ...LETTERS,
        not: true,
        all: true,
      }),
    ).toBe("bolt -c:r -c:g");
  });

  test("and a group someone else wrote is left as it was", () => {
    expect(
      write("(t:a or t:b)", KEY.colors, ["r", "g"], {
        ...LETTERS,
        not: true,
        all: true,
      }),
    ).toBe("(t:a or t:b) -c:r -c:g");
  });
});

describe("colorless", () => {
  const asks = (query: string, card: Card) => matches(parse(query), card, []);

  test("is the absence of colors, not the absence of a question", () => {
    expect(asks("c:c", sol)).toBe(true);
    expect(asks("c:c", bolt)).toBe(false);
    expect(asks("c:colorless", bolt)).toBe(false);
    expect(asks("id:c", bolt)).toBe(false);
    expect(asks("-c:c", bolt)).toBe(true);
  });

  test("compares as the empty set", () => {
    expect(asks("c>c", bolt)).toBe(true);
    expect(asks("c>c", sol)).toBe(false);
    expect(asks("c<=c", sol)).toBe(true);
    expect(asks("c!=c", bolt)).toBe(true);
  });

  test("and a card with no face answers neither way", () => {
    expect(asks("c:c", faceless)).toBe(false);
    expect(asks("c:r", faceless)).toBe(false);
  });

  test("a value naming no color at all asks for nothing", () => {
    expect(asks("c:zzz", bolt)).toBe(false);
    expect(asks("c:", bolt)).toBe(false);
  });
});
