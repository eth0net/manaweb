// One picture, read against the artwork index. Everything up to the answer
// and nothing about showing it, so a test can drive the whole path.

import type { Catalog } from "../catalog";
import {
  type Artworks,
  FLOOR,
  type Retrieved,
  retrieve,
} from "../catalog/artwork";
import type { Engine } from "./engine";

// What a canvas hands back, which is all of one this needs.
export interface Picture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// Bytes a canvas gives per pixel.
const RGBA = 4;

export interface Read extends Retrieved {
  // Whether a card was found in the frame rather than the framing guessed at.
  // A guess is worth saying out loud: it means the card was not where the
  // viewfinder expected one.
  detected: boolean;
  // Whether the margin clears [`FLOOR`], which is what an accept turns on.
  sure: boolean;
}

// Null where nothing could be cut from the frame, or where the index holds
// nothing to answer with.
export function read(
  engine: Engine,
  catalog: Catalog,
  index: Artworks,
  picture: Picture,
): Read | null {
  const { data, width, height } = picture;
  const levels = engine.luma(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    RGBA,
  );
  const asked = engine.query(levels, width, height);
  if (asked.hashes.length === 0) return null;

  const found = retrieve(catalog, index, asked.hashes);
  if (!found) return null;
  return {
    ...found,
    detected: asked.quad !== null,
    sure: found.margin >= FLOOR,
  };
}
