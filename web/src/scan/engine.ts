// The hashing, as the browser reaches it: `crates/scanner` compiled to wasm
// and called over its C ABI. No bindings generator, so what arrives is a
// pointer and a length and this module owns both sides of that.

// One word each, little-endian, as every integer in the catalog is.
const WORD = 8;

// What `scan_entry` answers for a frame the buffer does not hold.
const REFUSED = -1;

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
}

export class Engine {
  // The build's own name for its hashing, which an index has to match.
  readonly fingerprint: bigint;
  // Hashes one artwork carries, and what `entry` answers with.
  readonly hashes: number;

  #wasm: Exports;

  private constructor(wasm: Exports) {
    this.#wasm = wasm;
    this.hashes = wasm.scan_hashes();
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

  // A camera's rows carry padding past their pixels, so the stride is asked
  // for rather than taken from the width.
  entry(
    luma: Uint8Array,
    width: number,
    height: number,
    stride: number = width,
  ): bigint[] {
    const span = (height - 1) * stride + width;
    if (width <= 0 || height <= 0 || stride < width || luma.length < span) {
      throw new Error(
        `${width}x${height} at ${stride} is not in ${luma.length}`,
      );
    }

    const words = this.hashes * WORD;
    const at = this.#wasm.scan_alloc(span);
    const out = at === 0 ? 0 : this.#wasm.scan_alloc(words);
    if (at === 0 || out === 0) {
      if (at !== 0) this.#wasm.scan_free(at, span);
      throw new Error(`the engine has no room for ${span} bytes`);
    }

    try {
      // After both allocations: either of them may have grown the memory,
      // which leaves any view taken before it detached.
      const memory = new Uint8Array(this.#wasm.memory.buffer);
      memory.set(luma.subarray(0, span), at);

      if (this.#wasm.scan_entry(at, width, height, stride, out) === REFUSED) {
        throw new Error(`the engine refused ${width}x${height} at ${stride}`);
      }

      const read = new DataView(this.#wasm.memory.buffer);
      return Array.from({ length: this.hashes }, (_, which) =>
        read.getBigUint64(out + which * WORD, true),
      );
    } finally {
      this.#wasm.scan_free(at, span);
      this.#wasm.scan_free(out, words);
    }
  }
}
