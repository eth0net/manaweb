import { describe, expect, test } from "bun:test";
import { Catalog } from ".";
import { Artworks, artworks, retrieve } from "./artwork";

const PER = 4;

// The file as the exporter writes it: a header line padded so what follows is
// eight-byte aligned, the hashes, the back pairs, then the bitmap.
function file(
  artworks: (bigint[] | null)[],
  {
    fronts = artworks.length,
    backs = [] as [number, number][],
    hasher = "6c618393dccd0d94",
  } = {},
): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({
      version: "v1",
      hasher,
      hashes: PER,
      rows: artworks.length,
      fronts,
      absent: artworks.filter((held) => held === null).length,
      backs: backs.length,
    }),
  );

  let pad = 0;
  while ((header.length + pad + 1) % 8 !== 0) pad++;
  const from = header.length + pad + 1;

  const bitmap = Math.ceil(artworks.length / 8);
  const bytes = new Uint8Array(
    from + artworks.length * PER * 8 + backs.length * 8 + bitmap,
  );
  bytes.set(header);
  bytes.fill(0x20, header.length, from - 1);
  bytes[from - 1] = 0x0a;

  const view = new DataView(bytes.buffer);
  let at = from;
  for (const held of artworks) {
    for (let which = 0; which < PER; which++) {
      view.setBigUint64(at, held?.[which] ?? held?.[0] ?? 0n, true);
      at += 8;
    }
  }
  for (const [back, front] of backs) {
    view.setUint32(at, back, true);
    view.setUint32(at + 4, front, true);
    at += 8;
  }
  for (const [which, held] of artworks.entries()) {
    if (held) {
      const byte = at + (which >> 3);
      bytes[byte] = (bytes[byte] as number) | (1 << (which & 7));
    }
  }

  return bytes;
}

const ONE = 0x0123_4567_89ab_cdefn;
const TWO = 0xfedc_ba98_7654_3210n;

describe("the artwork index", () => {
  test("says what the header said", () => {
    const index = Artworks.read(file([[ONE], [TWO], null]));
    expect(index.version).toBe("v1");
    expect(index.rows).toBe(3);
    expect(index.hashes).toBe(PER);
    expect([index.has(0), index.has(1), index.has(2)]).toEqual([
      true,
      true,
      false,
    ]);
  });

  test("retrieves the artwork a hash came from", () => {
    const index = Artworks.read(file([[ONE], [TWO]]));
    expect(index.nearest([ONE])).toEqual({ artwork: 0, distance: 0 });
    expect(index.nearest([TWO])).toEqual({ artwork: 1, distance: 0 });
  });

  // The whole reason an artwork carries several: the query landed between
  // two framings and only the nearer one is close.
  test("reads every hash an artwork carries", () => {
    const index = Artworks.read(file([[ONE, ONE, TWO, ONE], [ONE ^ 0xffn]]));
    expect(index.nearest([TWO])).toEqual({ artwork: 0, distance: 0 });
  });

  // An artwork nothing hashed is zeroed, and so is a frame of pure black.
  test("never retrieves an artwork the build had no image for", () => {
    const index = Artworks.read(file([null, [TWO]]));
    const found = index.nearest([0n]);
    expect(found?.artwork).toBe(1);
  });

  test("holds nothing when it holds nothing", () => {
    expect(Artworks.read(file([null])).nearest([0n])).toBeNull();
  });

  test("names the front a back shares a printing with", () => {
    // Artwork 2 is only ever a back; 1 is the front of one card and the back
    // of another, so a match on it means either.
    const index = Artworks.read(
      file([[ONE], [TWO], [ONE ^ 1n]], {
        fronts: 2,
        backs: [
          [2, 0],
          [1, 0],
        ],
      }),
    );

    expect(index.faces(0)).toEqual([0]);
    expect(index.faces(1)).toEqual([1, 0]);
    expect(index.faces(2)).toEqual([0]);
  });

  // An export with no store publishes no part, and a client reading that
  // manifest has no scanner rather than no catalog.
  test("is absent from a manifest that names no part", async () => {
    expect(
      await artworks({
        version: "v1",
        cards: { name: "cards.aa.json", rows: 1, bytes: 1 },
        prints: { name: "prints.bb.json", rows: 1, bytes: 1 },
      }),
    ).toBeNull();
  });

  // Neither framing lands on the artwork alone; together they do, which is
  // the whole reason a query carries several.
  test("takes the nearest of every framing it is asked at", () => {
    const index = Artworks.read(file([[ONE], [TWO]]));
    const found = index.nearest([TWO ^ 0xfn, ONE ^ 0x3n]);

    expect(found).toEqual({ artwork: 0, distance: 2 });
  });

  test("refuses entries a different hash filled", () => {
    expect(() => Artworks.read(file([[ONE]], { hasher: "0000" }))).toThrow(
      "filled by 0000",
    );
  });

  test("refuses a header missing a count", () => {
    const whole = file([[ONE]]);
    const at = whole.indexOf(0x0a);
    const header = JSON.parse(
      new TextDecoder().decode(whole.subarray(0, at)),
    ) as Record<string, unknown>;
    delete header.fronts;

    const text = new TextEncoder().encode(JSON.stringify(header));
    const short = new Uint8Array(whole.length);
    short.set(whole);
    short.fill(0x20, 0, at);
    short.set(text, 0);

    expect(() => Artworks.read(short)).toThrow("no fronts");
  });

  test("refuses being asked against no hash at all", () => {
    expect(() => Artworks.read(file([[ONE]])).nearest([])).toThrow();
  });

  test("refuses a file it cannot place", () => {
    const whole = file([[ONE]]);
    expect(() => Artworks.read(whole.subarray(0, whole.length - 1))).toThrow();
    expect(() => Artworks.read(new Uint8Array([1, 2, 3]))).toThrow();
  });

  // A file fetched on its own starts at zero, but nothing in the format says
  // the bytes handed over have to.
  test("reads from a view the words are not aligned in", () => {
    const whole = file([[ONE], [TWO]]);
    const shifted = new Uint8Array(whole.length + 3);
    shifted.set(whole, 3);

    const index = Artworks.read(shifted.subarray(3));
    expect(index.nearest([TWO])).toEqual({ artwork: 1, distance: 0 });
  });
});

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
  kinds: ["card"],
  colors: ["W", "U", "B", "R", "G"],
  flags: [],
  // biome-ignore format: a positional row reads as a row
  cards: [
    [ID("0001"), "Delver of Secrets", "Creature", "{U}", 1, 2, 2, 0, 1, null, "1/1", 0, [], null],
    [ID("0002"), "Forest", "Basic Land", "", 0, null, 16, 0, 1, null, null, 0, [], null],
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
    "artwork",
  ],
  finishes: ["nonfoil"],
  flags: [],
  rarities: ["common"],
  layouts: ["transform"],
  imageStatuses: ["highres_scan"],
  langs: ["en"],
  artists: ["Nils Hamm"],
  sets: [["isd", "Innistrad", "expansion", "2011-09-30"]],
  // biome-ignore format: a positional row reads as a row
  prints: [
    [ID("0101"), 0, "51", 1, 0, 0, 0, 0, null, 0, 0, 0],
    [ID("0102"), 0, "254", 1, 0, 0, 0, 0, null, 0, 0, null],
  ],
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe("a hash against the catalog", () => {
  const catalog = Catalog.read(bytes(CARDS), bytes(PRINTS));

  test("names the printings the artwork is on", () => {
    const index = Artworks.read(file([[ONE]]));
    const found = retrieve(catalog, index, [ONE]);

    expect(found?.match).toEqual({ artwork: 0, distance: 0 });
    expect(found?.prints.map((one) => one.print.id)).toEqual([ID("0101")]);
    expect(found?.prints[0]?.card.name).toBe("Delver of Secrets");
  });

  // A photograph of the back has to resolve to the same printing as one of
  // the front, and no column names the back.
  test("resolves a back through the front it shares a printing with", () => {
    const index = Artworks.read(
      file([[ONE], [TWO]], { fronts: 1, backs: [[1, 0]] }),
    );
    const found = retrieve(catalog, index, [TWO]);

    expect(found?.match.artwork).toBe(1);
    expect(found?.prints.map((one) => one.print.id)).toEqual([ID("0101")]);
  });

  test("gives nothing for an artwork no printing carries", () => {
    expect(catalog.artwork(9)).toEqual([]);
  });
});
