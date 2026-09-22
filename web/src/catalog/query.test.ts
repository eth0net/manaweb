import { describe, expect, test } from "bun:test";
import type { Card, Print } from ".";
import { answering, bits, matches, type Node, parse, printed } from "./query";

// How many terms a parse came to, whatever shape they were grouped into.
function count(node: Node | null): number {
  if (!node) return 0;
  if (node.kind === "term") return 1;
  if (node.kind === "not") return count(node.of);
  return node.of.reduce((all, one) => all + count(one), 0);
}

function card(fields: Partial<Card> = {}): Card {
  return {
    index: 0,
    oracleId: "o",
    name: "Lightning Bolt",
    typeLine: "Instant",
    manaCost: "{R}",
    cmc: 1,
    colors: bits("R"),
    colorIdentity: bits("R"),
    kind: "card",
    printings: 1,
    edhrecRank: 100,
    stats: null,
    flags: [],
    faces: null,
    ...fields,
  };
}

function print(fields: Partial<Print> = {}): Print {
  return {
    id: "p",
    set: "lea",
    setName: "Limited Edition Alpha",
    released: "1993-08-05",
    collectorNumber: "161",
    finishes: ["nonfoil"],
    rarity: "common",
    layout: "normal",
    imageStatus: "highres_scan",
    lang: "en",
    printedName: null,
    artist: "Christopher Rush",
    flags: [],
    ...fields,
  };
}

function keeps(query: string, one: Card, prints: Print[] = [print()]) {
  return matches(parse(query), one, prints);
}

describe("parse", () => {
  test("bare words are the name, terms are not", () => {
    const query = parse("lightning c:r mv<=1");
    expect(query.text).toBe("lightning");
    expect(count(query.node)).toBe(2);
  });

  test("a quoted value holds together", () => {
    const node = parse('t:"legendary creature"').node;
    expect(node?.kind === "term" && node.term.value).toBe(
      "legendary creature",
    );
  });

  test("a term the device can't answer is named, not run", () => {
    const query = parse("o:draw usd>5");
    expect(query.missing).toEqual(["oracle text", "prices"]);
    expect(query.node).toBeNull();
  });

  test("a key we don't answer is reported rather than searched for", () => {
    expect(parse("frame:modern").missing).toEqual(["frame:"]);
  });

  test("order and direction are read out of the query", () => {
    const query = parse("c:r order:mv dir:desc");
    expect(query.order).toBe("mv");
    expect(query.direction).toBe("desc");
    expect(count(query.node)).toBe(1);
  });

  test("only printing terms ask for the printings", () => {
    expect(printed(parse("c:r mv<=3"))).toBe(false);
    expect(printed(parse("c:r s:lea"))).toBe(true);
  });
});

describe("grouping", () => {
  const bolt = card();
  const bear = card({
    colors: bits("G"),
    colorIdentity: bits("G"),
    manaCost: "{1}{G}",
  });

  test("`or` takes either side", () => {
    expect(keeps("c:r or c:u", bolt)).toBe(true);
    expect(keeps("c:w or c:u", bolt)).toBe(false);
  });

  test("adjacent terms are an and, and `or` binds looser", () => {
    expect(keeps("c:g mv:2 or c:r", bolt)).toBe(true);
    expect(keeps("c:g mv:9 or c:w", bear)).toBe(false);
  });

  test("parentheses group, and a minus refuses the group", () => {
    expect(keeps("-(s:lea or s:2ed)", bolt)).toBe(false);
    expect(keeps("-(s:m10 or s:2ed)", bolt)).toBe(true);
    expect(keeps("c:r (s:lea or s:m10)", bolt)).toBe(true);
  });

  test("a group left open closes at the end", () => {
    expect(keeps("(s:lea or s:m10", bolt)).toBe(true);
  });
});

describe("colors", () => {
  const bolt = card();
  const jace = card({ colors: bits("U"), colorIdentity: bits("U") });
  const gold = card({ colors: bits("WU"), colorIdentity: bits("WU") });
  const ring = card({ colors: bits(""), colorIdentity: bits("") });

  test("`c:` is at least, not exactly", () => {
    expect(keeps("c:r", bolt)).toBe(true);
    expect(keeps("c:wu", gold)).toBe(true);
    expect(keeps("c:w", gold)).toBe(true);
    expect(keeps("c:wu", jace)).toBe(false);
  });

  test("`c=` is exactly", () => {
    expect(keeps("c=wu", gold)).toBe(true);
    expect(keeps("c=w", gold)).toBe(false);
  });

  test("`c<=` is what a deck of those colors could play", () => {
    expect(keeps("c<=wu", jace)).toBe(true);
    expect(keeps("c<=wu", bolt)).toBe(false);
  });

  test("a number counts colors instead of naming them", () => {
    expect(keeps("c=2", gold)).toBe(true);
    expect(keeps("c>1", bolt)).toBe(false);
  });

  test("names, guilds and colorless all read as colors", () => {
    expect(keeps("c:red", bolt)).toBe(true);
    expect(keeps("c=azorius", gold)).toBe(true);
    expect(keeps("c:c", ring)).toBe(true);
    expect(keeps("c:m", gold)).toBe(true);
    expect(keeps("c:m", bolt)).toBe(false);
  });

  test("four-color names read both ways round", () => {
    const four = card({ colors: bits("UBRG"), colorIdentity: bits("UBRG") });
    expect(keeps("c=glint", four)).toBe(true);
    expect(keeps("c=chaos", four)).toBe(true);
  });

  test("a card whose colors are on its faces answers neither way", () => {
    const faced = card({ colors: null, colorIdentity: bits("WU") });
    expect(keeps("c:c", faced)).toBe(false);
    expect(keeps("c<=wu", faced)).toBe(false);
    expect(keeps("id<=wu", faced)).toBe(true);
  });

  test("identity is asked of the identity", () => {
    expect(keeps("id<=esper", jace)).toBe(true);
    expect(keeps("id<=esper", bolt)).toBe(false);
  });
});

describe("mana", () => {
  const bear = card({ manaCost: "{1}{G}", cmc: 2 });
  const titan = card({ manaCost: "{4}{G}{G}", cmc: 6 });

  test("a cost holding more of the same is greater", () => {
    expect(keeps("m>1G", titan)).toBe(true);
    expect(keeps("m>1G", bear)).toBe(false);
    expect(keeps("m:GG", titan)).toBe(true);
    expect(keeps("m:GG", bear)).toBe(false);
  });

  test("generic is counted, not named", () => {
    expect(keeps("m>=4", titan)).toBe(true);
    expect(keeps("m>=4", bear)).toBe(false);
  });

  test("braces are optional", () => {
    expect(keeps("m={4}{G}{G}", titan)).toBe(true);
    expect(keeps("m=4GG", titan)).toBe(true);
  });
});

describe("stats", () => {
  const goyf = card({ stats: "*/1+*" });
  const bear = card({ stats: "2/2" });
  const wall = card({ stats: "0/4" });

  test("a power that isn't a number matches nothing", () => {
    expect(keeps("pow>=1", goyf)).toBe(false);
    expect(keeps("pow<1", goyf)).toBe(false);
  });

  test("power compares against toughness as well as a number", () => {
    expect(keeps("pow>tou", wall)).toBe(false);
    expect(keeps("tou>pow", wall)).toBe(true);
    expect(keeps("pow=2", bear)).toBe(true);
  });
});

describe("printings", () => {
  const bolt = card();

  test("a card matches when any of its printings does", () => {
    const prints = [
      print({ set: "lea" }),
      print({ set: "m10", rarity: "rare" }),
    ];
    expect(keeps("s:m10", bolt, prints)).toBe(true);
    expect(keeps("r:rare", bolt, prints)).toBe(true);
    expect(keeps("s:war", bolt, prints)).toBe(false);
  });

  test("two printing terms want one printing, not two", () => {
    const prints = [
      print({ set: "lea" }),
      print({ set: "m10", rarity: "rare" }),
    ];
    expect(keeps("s:lea r:rare", bolt, prints)).toBe(false);
    expect(keeps("s:m10 r:rare", bolt, prints)).toBe(true);
  });

  test("`in:` asks whether it was ever printed that way", () => {
    const prints = [
      print({ set: "lea" }),
      print({ set: "m10", rarity: "rare" }),
    ];
    expect(keeps("s:lea in:rare", bolt, prints)).toBe(true);
    expect(keeps("s:lea in:mythic", bolt, prints)).toBe(false);
    expect(keeps("in:ja", bolt, [print({ lang: "ja" })])).toBe(true);
    expect(keeps("in:paper", bolt)).toBe(true);
  });

  test("the printing that answered is the one handed back", () => {
    const prints = [print({ set: "lea" }), print({ set: "m10" })];
    expect(answering(parse("s:m10"), bolt, prints)?.set).toBe("m10");
    expect(answering(parse("c:r"), bolt, prints)).toBeUndefined();
  });

  test("rarity is ordered, not named", () => {
    expect(keeps("r>=uncommon", bolt, [print({ rarity: "mythic" })])).toBe(
      true,
    );
    expect(keeps("r>=uncommon", bolt)).toBe(false);
  });

  test("a year comes off the set's day", () => {
    expect(keeps("year<=1994", bolt)).toBe(true);
    expect(keeps("year>1994", bolt)).toBe(false);
  });

  test("a flag is asked for as it is typed, not as the file spells it", () => {
    const full = [print({ flags: ["fullArt"] })];
    expect(keeps("is:fullart", card({ flags: ["gameChanger"] }), full)).toBe(
      true,
    );
    expect(keeps("is:gamechanger", card({ flags: ["gameChanger"] }))).toBe(
      true,
    );
  });

  test("`is:` asks the finishes, `not:` asks the other way", () => {
    expect(keeps("is:nonfoil", bolt)).toBe(true);
    expect(keeps("is:foil", bolt)).toBe(false);
    expect(keeps("not:foil", bolt)).toBe(true);
  });

  test("a minus refuses whatever the term would keep", () => {
    expect(keeps("-s:lea", bolt)).toBe(false);
    expect(keeps("-s:m10", bolt)).toBe(true);
  });
});
