// The hashing, as the browser reaches it: `crates/scanner` compiled to wasm
// and called over its C ABI. No bindings generator, so what arrives is a
// pointer and a length and this module owns both sides of that.

// One word each, little-endian, as every integer in the catalog is.
const WORD = 8;

// Four bytes, which is both a float and the pointer a wasm32 module counts in.
const HALF = 4;

// A corner each way, four of them.
const CORNERS = 8;

// What a call answers for a frame the buffer does not hold.
const REFUSED = -1;

// And where it wrote nothing: no card in the frame, or no room for one.
const NOTHING = 1;

// A point of a frame, in its own pixels and not necessarily on a whole one.
export interface Point {
  x: number;
  y: number;
}

// A card's four corners, clockwise from one end of a short side, so that
// rectifying one stands it portrait whichever way round it lay.
export type Quad = [Point, Point, Point, Point];

// A card read back as a rectangle of its own proportions.
export interface Card {
  levels: Uint8Array;
  width: number;
  height: number;
}

// What one frame asks the index, and what framed the asking.
export interface Query {
  hashes: bigint[];
  // The card that was found, or null where the framing was guessed at.
  quad: Quad | null;
}

interface Exports {
  memory: WebAssembly.Memory;
  scan_alloc(bytes: number): number;
  scan_free(at: number, bytes: number): void;
  scan_hashes(): number;
  scan_fingerprint(): bigint;
  scan_entry(
    at: number,
    width: number,
    height: number,
    stride: number,
    out: number,
  ): number;
  scan_luma(at: number, pixels: number, step: number, out: number): number;
  scan_detect(
    at: number,
    width: number,
    height: number,
    stride: number,
    out: number,
  ): number;
  scan_rectify(
    at: number,
    width: number,
    height: number,
    stride: number,
    quad: number,
    out: number,
    room: number,
    size: number,
  ): number;
  scan_query_words(): number;
  scan_query(
    at: number,
    width: number,
    height: number,
    stride: number,
    out: number,
    quad: number,
  ): number;
}

export class Engine {
  // The build's own name for its hashing, which an index has to match.
  readonly fingerprint: bigint;
  // Hashes one artwork carries, and what `entry` answers with.
  readonly hashes: number;
  // The most `query` can answer with, a frame it found no card in being
  // asked at more framings than one it did.
  readonly words: number;

  #wasm: Exports;

  private constructor(wasm: Exports) {
    this.#wasm = wasm;
    this.hashes = wasm.scan_hashes();
    this.words = wasm.scan_query_words();
    this.fingerprint = wasm.scan_fingerprint();
  }

  // A Response streams and compiles at once; bytes are for a caller that
  // already has them, which is every check and no browser.
  static async load(
    source: Uint8Array | Response | Promise<Response>,
  ): Promise<Engine> {
    const held =
      source instanceof Uint8Array
        ? await WebAssembly.instantiate(source, {})
        : await WebAssembly.instantiateStreaming(source, {});
    return new Engine(held.instance.exports as unknown as Exports);
  }

  // Room for each of `sizes`, the call, then the room given back however
  // that ends. Every view of the memory is taken inside the call, because an
  // allocation may have moved what one taken before it points at.
  #room<const N extends readonly number[], T>(
    sizes: N,
    run: (at: { [K in keyof N]: number }) => T,
  ): T {
    const at: number[] = sizes.map(() => 0);
    try {
      for (const [which, bytes] of sizes.entries()) {
        const held = bytes === 0 ? 0 : this.#wasm.scan_alloc(bytes);
        if (bytes !== 0 && held === 0) {
          throw new Error(`the engine has no room for ${bytes} bytes`);
        }
        at[which] = held;
      }
      return run(at as unknown as { [K in keyof N]: number });
    } finally {
      for (const [which, bytes] of sizes.entries()) {
        const held = at[which];
        if (held) this.#wasm.scan_free(held, bytes);
      }
    }
  }

  // Here rather than in a loop over the pixels: the builder converts through
  // the same arithmetic, and the fingerprint covers it.
  luma(color: Uint8Array, step = 4): Uint8Array {
    const pixels = Math.floor(color.length / step);
    if (step < 3 || pixels === 0) {
      throw new Error(`${color.length} bytes of ${step} is no picture`);
    }

    return this.#room([pixels * step, pixels], ([at, out]) => {
      new Uint8Array(this.#wasm.memory.buffer).set(
        color.subarray(0, pixels * step),
        at,
      );
      if (this.#wasm.scan_luma(at, pixels, step, out) === REFUSED) {
        throw new Error(`the engine refused ${step} bytes a pixel`);
      }
      // A copy, because the next allocation may move what this points at.
      return new Uint8Array(this.#wasm.memory.buffer).slice(out, out + pixels);
    });
  }

  // A camera's rows carry padding past their pixels, so the stride is asked
  // for rather than taken from the width.
  entry(
    luma: Uint8Array,
    width: number,
    height: number,
    stride: number = width,
  ): bigint[] {
    const span = this.#span(luma, width, height, stride);
    return this.#room([span, this.hashes * WORD], ([at, out]) => {
      this.#plane(luma, span, at);
      if (this.#wasm.scan_entry(at, width, height, stride, out) === REFUSED) {
        throw new Error(`the engine refused ${width}x${height} at ${stride}`);
      }
      return this.#words(out, this.hashes);
    });
  }

  // The card in a frame, or null where nothing in it is shaped like one.
  detect(
    luma: Uint8Array,
    width: number,
    height: number,
    stride: number = width,
  ): Quad | null {
    const span = this.#span(luma, width, height, stride);
    return this.#room([span, CORNERS * HALF], ([at, out]) => {
      this.#plane(luma, span, at);
      const found = this.#wasm.scan_detect(at, width, height, stride, out);
      if (found === REFUSED) {
        throw new Error(`the engine refused ${width}x${height} at ${stride}`);
      }
      return found === NOTHING ? null : this.#corners(out);
    });
  }

  // A card standing upright, its foreshortening undone, or null where the
  // corners enclose nothing.
  rectify(
    luma: Uint8Array,
    width: number,
    height: number,
    quad: Quad,
    stride: number = width,
  ): Card | null {
    const span = this.#span(luma, width, height, stride);
    // No room at all on the first call, so that it answers with the size and
    // the room is made once.
    return this.#room(
      [span, CORNERS * HALF, 2 * HALF],
      ([at, corners, size]) => {
        this.#plane(luma, span, at);
        const held = new DataView(this.#wasm.memory.buffer);
        quad.forEach((point, corner) => {
          held.setFloat32(corners + corner * 2 * HALF, point.x, true);
          held.setFloat32(corners + (corner * 2 + 1) * HALF, point.y, true);
        });

        const cut = (out: number, room: number) =>
          this.#wasm.scan_rectify(
            at,
            width,
            height,
            stride,
            corners,
            out,
            room,
            size,
          );
        if (cut(0, 0) === REFUSED) return null;

        const read = new DataView(this.#wasm.memory.buffer);
        const wide = read.getUint32(size, true);
        const tall = read.getUint32(size + HALF, true);
        return this.#room([wide * tall], ([out]) => {
          if (cut(out, wide * tall) !== 0) return null;
          return {
            levels: new Uint8Array(this.#wasm.memory.buffer).slice(
              out,
              out + wide * tall,
            ),
            width: wide,
            height: tall,
          };
        });
      },
    );
  }

  // Everything a frame asks the index: the card in it read back both ways up,
  // or, where there is none, the framings it might have had.
  query(
    luma: Uint8Array,
    width: number,
    height: number,
    stride: number = width,
  ): Query {
    const span = this.#span(luma, width, height, stride);
    return this.#room(
      [span, this.words * WORD, CORNERS * HALF],
      ([at, out, corners]) => {
        this.#plane(luma, span, at);
        const asked = this.#wasm.scan_query(
          at,
          width,
          height,
          stride,
          out,
          corners,
        );
        if (asked === REFUSED) {
          throw new Error(
            `the engine refused ${width}x${height} at ${stride}`,
          );
        }
        const quad = this.#corners(corners);
        // All zero is the engine saying it found no card and guessed at the
        // framing instead; a real one encloses something.
        const found = quad.some((point) => point.x !== 0 || point.y !== 0);
        return { hashes: this.#words(out, asked), quad: found ? quad : null };
      },
    );
  }

  // The bytes a plane covers, which is what every call below is handed.
  #span(
    luma: Uint8Array,
    width: number,
    height: number,
    stride: number,
  ): number {
    const span = (height - 1) * stride + width;
    if (width <= 0 || height <= 0 || stride < width || luma.length < span) {
      throw new Error(
        `${width}x${height} at ${stride} is not in ${luma.length}`,
      );
    }
    return span;
  }

  #plane(luma: Uint8Array, span: number, at: number): void {
    new Uint8Array(this.#wasm.memory.buffer).set(luma.subarray(0, span), at);
  }

  #words(at: number, count: number): bigint[] {
    const read = new DataView(this.#wasm.memory.buffer);
    return Array.from({ length: count }, (_, which) =>
      read.getBigUint64(at + which * WORD, true),
    );
  }

  #corners(at: number): Quad {
    const read = new DataView(this.#wasm.memory.buffer);
    const point = (corner: number) => ({
      x: read.getFloat32(at + corner * 2 * HALF, true),
      y: read.getFloat32(at + (corner * 2 + 1) * HALF, true),
    });
    return [point(0), point(1), point(2), point(3)];
  }
}
