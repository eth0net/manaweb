// The engine as a page reaches it, imported for its URL rather than fetched
// from a path this names — `docs/scanner.md`.

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
