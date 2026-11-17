// A camera, the engine behind it and an index to read, for tests that render
// the viewfinder. Needs `bun test --isolate`, as anything defining globals
// does.

import { join } from "node:path";
import type { Entry, Manifest } from "../catalog";
import { file } from "./artwork";
import "./dom";
import { database } from "./idb";

// Read where it is served rather than at the top: an await out here leaves
// every export below it unreachable to whoever imported them.
const WASM = join(import.meta.dir, "../scan/engine.wasm");

const ARTWORK: Entry = { name: "artwork.aa.bin", rows: 1, bytes: 0 };

// One artwork, which is all the viewfinder asks the index to have in it.
const INDEX = file([[0x0123_4567_89ab_cdefn]]);

export const MANIFEST: Manifest = {
  version: "v1",
  cards: { name: "cards.aa.json", rows: 1, bytes: 1 },
  prints: { name: "prints.bb.json", rows: 1, bytes: 1 },
  artwork: ARTWORK,
};

// Everything the viewfinder reaches for that a test process has none of.
export function scanning(): void {
  database();
  camera();
  serving();
  streaming();
}

// A registered document brings its own `Response`, which the runtime refuses
// as the one it holds — so the bytes go over whole instead.
function streaming(): void {
  define(
    WebAssembly,
    "instantiateStreaming",
    async (
      source: Response | Promise<Response>,
      imports: WebAssembly.Imports,
    ) => WebAssembly.instantiate(await (await source).arrayBuffer(), imports),
  );
}

// A camera that opens and stops, showing nothing: what a press reaches is
// the page rather than the engine.
function camera(): void {
  // `srcObject` is checked against the registered document's own class.
  const stream = new MediaStream();
  // Which holds no tracks, and stopping a camera walks them.
  define(stream, "getTracks", () => [{ stop() {}, kind: "video" }]);

  define(navigator, "mediaDevices", {
    getUserMedia: () => Promise.resolve(stream),
  });
  // happy-dom has the element and not the verb.
  define(HTMLMediaElement.prototype, "play", () => Promise.resolve());
}

function serving(): void {
  define(globalThis, "fetch", (input: RequestInfo | URL) => {
    const at = input instanceof Request ? input.url : String(input);
    if (at.endsWith(".wasm")) {
      return Bun.file(WASM)
        .bytes()
        .then(
          (bytes) =>
            new Response(bytes, {
              headers: { "content-type": "application/wasm" },
            }),
        );
    }
    if (at.endsWith(ARTWORK.name)) {
      return Promise.resolve(new Response(INDEX));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

// Defined rather than assigned, a plain assignment being refused once the
// property is there.
function define(on: object, name: string, value: unknown): void {
  Object.defineProperty(on, name, {
    value,
    configurable: true,
    writable: true,
  });
}
