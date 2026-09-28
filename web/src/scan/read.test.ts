import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Catalog } from "../catalog";
import { Artworks } from "../catalog/artwork";
import { Engine } from "./engine";
import { read } from "./read";

// The module the client is served, driven the way a browser drives it. The
// point is the whole path in one go: pixels, the card found in them, the
// crops, and the artwork they retrieve.
const engine = await Engine.load(
  await Bun.file(join(import.meta.dir, "engine.wasm")).bytes(),
);

const WIDE = 400;
const TALL = 300;

// A card on a surface, as `crates/scanner`'s own tests draw one.
function picture(x: number, y: number, wide: number, tall: number): ImageData {
  const data = new Uint8ClampedArray(WIDE * TALL * 4).fill(255);
  for (let at = 0; at < WIDE * TALL; at++) {
    const inside =
      at % WIDE >= x &&
      at % WIDE < x + wide &&
      Math.floor(at / WIDE) >= y &&
      Math.floor(at / WIDE) < y + tall;
    const level = inside
      ? 140 + (((at % WIDE) * 7 + Math.floor(at / WIDE) * 11) % 100)
      : 30;
    data[at * 4] = level;
    data[at * 4 + 1] = level;
    data[at * 4 + 2] = level;
  }
  return { data, width: WIDE, height: TALL } as ImageData;
}

// An index holding whatever the engine makes of one picture, so a scan of it
// retrieves artwork 0 exactly and the other rows are something to beat.
function indexed(of: ImageData, others: bigint[][]): Artworks {
  const levels = engine.luma(new Uint8Array(of.data.buffer), 4);
  const asked = engine.query(levels, of.width, of.height);
  const rows = [asked.hashes.slice(0, engine.hashes), ...others];

  const words = new Uint32Array(rows.length * engine.hashes * 2);
  rows.forEach((row, at) => {
    for (let which = 0; which < engine.hashes; which++) {
      const hash = row[which] ?? row[0] ?? 0n;
      words[(at * engine.hashes + which) * 2] = Number(
        BigInt.asUintN(32, hash),
      );
      words[(at * engine.hashes + which) * 2 + 1] = Number(
        BigInt.asUintN(32, hash >> 32n),
      );
    }
  });

  return new Artworks(
    {
      version: "v1",
      hasher: engine.hasher,
      hashes: engine.hashes,
      rows: rows.length,
      fronts: rows.length,
      absent: 0,
      backs: 0,
    },
    words,
    new Uint32Array(0),
    new Uint8Array(Math.ceil(rows.length / 8)).fill(0xff),
  );
}

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
const catalog = Catalog.read(bytes(CARDS), bytes(PRINTS));

describe("a picture against the index", () => {
  const shot = picture(100, 60, 126, 176);

  test("retrieves the artwork the card carries", () => {
    const index = indexed(shot, [[0n], [~0n & ((1n << 64n) - 1n)]]);
    const found = read(engine, catalog, index, shot);

    expect(found?.matches[0]?.artwork).toBe(0);
    expect(found?.matches[0]?.distance).toBe(0);
    expect(found?.prints.map((one) => one.print.id)).toEqual([ID("0101")]);
  });

  // The whole point of the margin: the answer is the same either way, and
  // only how far off the runner-up was says whether to believe it.
  test("is sure when nothing else comes close", () => {
    const index = indexed(shot, [[0n], [~0n & ((1n << 64n) - 1n)]]);
    expect(read(engine, catalog, index, shot)?.sure).toBe(true);
  });

  test("is unsure when another artwork is as near", () => {
    const levels = engine.luma(new Uint8Array(shot.data.buffer), 4);
    const near = engine.query(levels, shot.width, shot.height)
      .hashes[0] as bigint;
    const index = indexed(shot, [[near ^ 0x3n]]);

    const found = read(engine, catalog, index, shot);
    expect(found?.margin).toBeLessThan(4);
    expect(found?.sure).toBe(false);
  });

  test("says a card was found rather than the framing guessed at", () => {
    expect(read(engine, catalog, indexed(shot, []), shot)?.detected).toBe(
      true,
    );
  });

  test("says when the framing was guessed at instead", () => {
    const filled = picture(0, 0, WIDE, 260);
    const found = read(engine, catalog, indexed(filled, []), filled);
    expect(found?.detected).toBe(false);
  });
});
