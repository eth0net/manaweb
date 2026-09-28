// The engine as a page reaches it, imported for its URL rather than fetched
// from a path this names — `docs/scanner.md`.

import type { Manifest } from "../catalog";
import { type Artworks, artworks } from "../catalog/artwork";
import { Engine } from "./engine";
import url from "./engine.wasm?url";

let held: Promise<Engine> | null = null;

// One instance for the page: compiling the module is the expensive part and
// nothing it answers depends on what it was asked before.
export function engine(): Promise<Engine> {
  held ??= Engine.load(fetch(url)).catch((failed: unknown) => {
    // A failed load is not kept, so a second scan can try again rather than
    // being handed the first one's error forever.
    held = null;
    throw failed;
  });
  return held;
}

// And the index it reads, which is megabytes only a scan wants — so it is
// fetched here rather than with the catalog every page loads.
let reading: { of: string; held: Promise<Artworks | null> } | null = null;

// Null where the export published no index to read.
export async function index(manifest: Manifest): Promise<Artworks | null> {
  const of = manifest.artwork?.name ?? "";
  if (reading?.of !== of) {
    reading = {
      of,
      held: engine()
        .then((held) => artworks(manifest, held.hasher))
        .catch((failed: unknown) => {
          if (reading?.of === of) reading = null;
          throw failed;
        }),
    };
  }
  return reading.held;
}
