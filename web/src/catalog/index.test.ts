import { describe, expect, test } from "bun:test";
import { Catalog, printKey } from ".";

const ID = (one: string) => `0000579f-7b35-4ed3-b44c-db2a5380${one}`;

const CARDS = JSON.stringify({
  version: "v1",
  fields: [
    "oracleId",
    "name",
    "typeLine",
    "manaCost",
    "cmc",
    "colors",
    "colorIdentity",
    "kind",
    "printings",
    "edhrecRank",
    "stats",
    "flags",
    "keywords",
    "faces",
  ],
  kinds: ["card", "token"],
  colors: ["W", "U", "B", "R", "G"],
  flags: ["reserved", "gameChanger"],
  // biome-ignore format: a positional row reads as a row
  cards: [
    [ID("0001"), "Ancestral Recall", "Instant", "{U}", 1, 2, 2, 0, 2, 7, null, 1, [], null],
    [ID("0002"), "Forest", "Basic Land — Forest", "", 0, null, 16, 0, 1, null, null, 0, [], null],
  ],
});

const PRINTS = JSON.stringify({
  version: "v1",
  fields: [
    "id",
    "set",
    "collectorNumber",
    "finishes",
    "rarity",
    "layout",
    "imageStatus",
    "lang",
    "printedName",
    "artist",
    "flags",
  ],
  finishes: ["nonfoil", "foil"],
  flags: ["promo", "variation"],
  rarities: ["common", "rare"],
  layouts: ["normal"],
  imageStatuses: ["highres_scan"],
  langs: ["en", "ja"],
  artists: ["Mark Poole"],
  sets: [
    ["lea", "Limited Edition Alpha", "core", "1993-08-05"],
    ["m10", "Magic 2010", "core", "2009-07-17"],
  ],
  // biome-ignore format: a positional row reads as a row
  prints: [
    [ID("0101"), 0, "48", 1, 1, 0, 0, 0, null, 0, 0],
    [ID("0102"), 1, "329★", 3, 1, 0, 0, 1, "祖先の記憶", null, 2],
    [ID("0103"), 0, "203", 1, 0, 0, 0, 0, null, 0, 0],
  ],
});

const bytes = (text: string) => new TextEncoder().encode(text);
const held = () => Catalog.read(bytes(CARDS), bytes(PRINTS));

// Rebuilt rather than patched: the fixtures above are stringified, so there is
// no whitespace in them to match on.
function edited(
  file: string,
  change: (held: { fields: string[]; cards: unknown[][] }) => void,
): string {
  const held = JSON.parse(file) as { fields: string[]; cards: unknown[][] };
  change(held);
  return JSON.stringify(held);
}

describe("a catalog read from its two files", () => {
  test("gives back the card a row went in as", () => {
    const card = held().card(0);
    expect(card).toEqual({
      index: 0,
      oracleId: ID("0001"),
      name: "Ancestral Recall",
      typeLine: "Instant",
      manaCost: "{U}",
      cmc: 1,
      colors: 2,
      colorIdentity: 2,
      kind: "card",
      printings: 2,
      edhrecRank: 7,
      stats: null,
      flags: ["reserved"],
      faces: null,
    });
  });

  test("and absent is not empty on the way back out", () => {
    const card = held().card(1);
    expect(card.manaCost).toBe("");
    expect(card.colors).toBeNull();
    expect(card.edhrecRank).toBeNull();
    expect(card.stats).toBeNull();
    expect(card.flags).toEqual([]);
  });

  test("with the printings in their own run per card", () => {
    const catalog = held();
    expect(catalog.cards).toBe(2);
    expect(catalog.printings).toBe(3);
    expect(catalog.prints(0).map((print) => print.id)).toEqual([
      ID("0101"),
      ID("0102"),
    ]);
    expect(catalog.prints(1).map((print) => print.id)).toEqual([ID("0103")]);
    expect(catalog.prints(0, "ja").map((print) => print.printedName)).toEqual([
      "祖先の記憶",
    ]);
  });

  test("each decoded against the tables its integers index", () => {
    const print = held().prints(0)[1];
    expect(print).toEqual({
      id: ID("0102"),
      set: "m10",
      setName: "Magic 2010",
      released: "2009-07-17",
      collectorNumber: "329★",
      finishes: ["nonfoil", "foil"],
      rarity: "rare",
      layout: "normal",
      imageStatus: "highres_scan",
      lang: "ja",
      printedName: "祖先の記憶",
      artist: null,
      flags: ["variation"],
    });
  });

  test("and looked up by id or by set and number", () => {
    const catalog = held();
    expect(catalog.locate(new Set([printKey("m10", "329★")]))).toEqual(
      new Map([["m10/329★", ID("0102")]]),
    );
    expect(catalog.bySet([ID("0101"), ID("0103")])).toEqual(
      new Map([["lea", 2]]),
    );
    const found = catalog.resolve([ID("0103")]);
    expect(found.get(ID("0103"))?.card.name).toBe("Forest");
  });

  test("a column this client has no reader for is read past", () => {
    const held = edited(CARDS, (file) => {
      file.fields.push("keywords");
      for (const row of file.cards) row.push([]);
    });

    const catalog = Catalog.read(bytes(held), bytes(PRINTS));

    // The last column it reads, so the one an added column would disturb.
    expect(catalog.card(0).name).toBe("Ancestral Recall");
    expect(catalog.card(0).flags).toEqual(["reserved"]);
  });

  test("but a column that moved is refused, the rows being positional", () => {
    const held = edited(CARDS, (file) => {
      file.fields.reverse();
    });

    expect(() => Catalog.read(bytes(held), bytes(PRINTS))).toThrow(
      "this client reads",
    );
  });

  test("a total that disagrees with the rows is refused", () => {
    const short = PRINTS.replace(
      `,[${JSON.stringify(ID("0103"))},0,"203",1,0,0,0,0,null,0,0]`,
      "",
    );
    expect(() => Catalog.read(bytes(CARDS), bytes(short))).toThrow(
      "claims 3 printings and holds 2",
    );
  });
});
