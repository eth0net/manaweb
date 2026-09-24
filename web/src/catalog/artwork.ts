// The artwork index, which is the opt-in part of the catalog a scan reads:
// one entry per illustration, each held as several hashes so a photograph
// framed a little wide still lands on it. What the file holds, and in which
// order, is `docs/scryfall.md`.
//
// Read where it lies rather than copied out, which is why the file pads its
// header to an eight-byte boundary.

import type { Card, Catalog, Manifest, Print } from ".";
import { part } from "./load";

export interface ArtworkHeader {
  version: string;
  hashes: number;
  rows: number;
  // Of the rows, how many a printing can name. The rest are backs.
  fronts: number;
  absent: number;
  backs: number;
}

export interface Match {
  artwork: number;
  // Bits differing, out of 64. Zero is the same illustration.
  distance: number;
}

const NEWLINE = 10;
const WORD = 8;
const HALF = 4;

// Typed arrays read in the machine's own order and the file is little-endian.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

// Bits set in a 32-bit word. JavaScript's bitwise operators stop there, so a
// 64-bit hash is compared as two halves.
function bits(word: number): number {
  let held = word - ((word >>> 1) & 0x55555555);
  held = (held & 0x33333333) + ((held >>> 2) & 0x33333333);
  held = (held + (held >>> 4)) & 0x0f0f0f0f;
  return Math.imul(held, 0x01010101) >>> 24;
}

export class Artworks {
  readonly version: string;
  readonly rows: number;
  readonly fronts: number;
  // How many hashes each artwork carries.
  readonly hashes: number;

  // Every hash as its two halves, artwork by artwork.
  #words: Uint32Array;
  #held: Uint8Array;
  // The fronts each back shares a printing with.
  #backs: Map<number, number[]>;

  static read(bytes: Uint8Array): Artworks {
    if (!LITTLE_ENDIAN) {
      throw new Error("the artwork index wants a little-endian machine");
    }

    const newline = bytes.indexOf(NEWLINE);
    if (newline < 0) throw new Error("the artwork index has no header");
    const header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(0, newline)),
    ) as ArtworkHeader;

    // `fronts` is the one count nothing below is sized by, so a missing one
    // reaches every lookup and answers each with no printings.
    for (const key of ["hashes", "rows", "fronts", "backs"] as const) {
      if (!Number.isInteger(header[key]) || header[key] < 0) {
        throw new Error(`the artwork index has no ${key}`);
      }
    }
    if (header.fronts > header.rows) {
      throw new Error(
        `the artwork index numbers ${header.fronts} fronts of ${header.rows}`,
      );
    }

    const from = newline + 1;
    const words = header.rows * header.hashes * 2;
    const pairs = header.backs * 2;
    const bitmap = Math.ceil(header.rows / 8);
    const wanted = from + (words + pairs) * HALF + bitmap;
    if (bytes.length !== wanted) {
      throw new Error(
        `the artwork index holds ${bytes.length} bytes against ${wanted}`,
      );
    }

    // A view needs the words aligned; a file fetched on its own already is.
    const at = bytes.byteOffset + from;
    const held =
      at % WORD === 0
        ? { buffer: bytes.buffer, from: at }
        : { buffer: bytes.slice(from).buffer, from: 0 };

    return new Artworks(
      header,
      new Uint32Array(held.buffer, held.from, words),
      new Uint32Array(held.buffer, held.from + words * HALF, pairs),
      new Uint8Array(held.buffer, held.from + (words + pairs) * HALF, bitmap),
    );
  }

  constructor(
    header: ArtworkHeader,
    words: Uint32Array,
    pairs: Uint32Array,
    held: Uint8Array,
  ) {
    // `read` sizes these from the same header, so this only catches a caller
    // that built them itself: short ones read past their end as zero and give
    // a confident wrong distance rather than failing.
    if (
      words.length !== header.rows * header.hashes * 2 ||
      held.length < Math.ceil(header.rows / 8)
    ) {
      throw new Error(`the artwork index holds no ${header.rows} artworks`);
    }

    this.version = header.version;
    this.rows = header.rows;
    this.fronts = header.fronts;
    this.hashes = header.hashes;
    this.#words = words;
    this.#held = held;
    this.#backs = new Map();

    for (let at = 0; at < pairs.length; at += 2) {
      const back = pairs[at] as number;
      const front = pairs[at + 1] as number;
      if (back >= header.rows || front >= header.fronts) {
        throw new Error(`the artwork index pairs ${back} with ${front}`);
      }
      const known = this.#backs.get(back);
      if (known) known.push(front);
      else this.#backs.set(back, [front]);
    }
  }

  // Whether the build had an image for this artwork. The one bit worth
  // testing: an artwork with none is zeroed, and so is a frame of pure black.
  has(artwork: number): boolean {
    const byte = this.#held[artwork >> 3];
    return byte !== undefined && (byte & (1 << (artwork & 7))) !== 0;
  }

  // The artwork nearest any of these hashes, or null where the index holds
  // nothing. Several, because a query is asked at several framings.
  nearest(hashes: readonly bigint[]): Match | null {
    // Null is the index holding nothing, so asking nothing has to be the
    // caller's bug rather than the same answer.
    if (hashes.length === 0) throw new Error("no hash to retrieve against");

    const asked = new Int32Array(hashes.length * 2);
    for (const [at, hash] of hashes.entries()) {
      asked[at * 2] = Number(BigInt.asUintN(32, hash)) | 0;
      asked[at * 2 + 1] = Number(BigInt.asUintN(32, hash >> 32n)) | 0;
    }

    const words = this.#words;
    const held = this.#held;
    const each = this.hashes * 2;

    let artwork = -1;
    let distance = 65;
    for (let at = 0; at < this.rows; at++) {
      if (((held[at >> 3] as number) & (1 << (at & 7))) === 0) continue;

      const base = at * each;
      for (let which = 0; which < each; which += 2) {
        const lo = words[base + which] as number;
        const hi = words[base + which + 1] as number;
        for (let ask = 0; ask < asked.length; ask += 2) {
          const found =
            bits(lo ^ (asked[ask] as number)) +
            bits(hi ^ (asked[ask + 1] as number));
          if (found < distance) {
            distance = found;
            artwork = at;
          }
        }
      }
    }

    return artwork < 0 ? null : { artwork, distance };
  }

  // Which numbers a printings column could carry for this artwork: its own
  // when a front bears it, and the front of every printing it backs. A match
  // never says by itself which side of a card was photographed.
  faces(artwork: number): number[] {
    const found = artwork < this.fronts ? [artwork] : [];
    for (const front of this.#backs.get(artwork) ?? []) {
      if (!found.includes(front)) found.push(front);
    }
    return found;
  }
}

// The index this manifest names, or null where the export had no hashes to
// build one from.
export async function artworks(manifest: Manifest): Promise<Artworks | null> {
  if (!manifest.artwork) return null;
  return Artworks.read(new Uint8Array(await part(manifest.artwork)));
}

export interface Retrieved {
  match: Match;
  prints: { card: Card; print: Print }[];
}

// What a query retrieves: the artwork nearest it, then every printing that
// artwork appears on, whichever side of the card it sits on.
export function retrieve(
  catalog: Catalog,
  index: Artworks,
  hashes: readonly bigint[],
): Retrieved | null {
  const match = index.nearest(hashes);
  if (!match) return null;
  return {
    match,
    prints: index
      .faces(match.artwork)
      .flatMap((number) => catalog.artwork(number)),
  };
}
