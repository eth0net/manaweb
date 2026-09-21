// A column of strings held as one run of UTF-8 bytes rather than an array of
// them, read out by index. Written a batch at a time, so the strings a batch
// parsed are collectable before the next arrives — see `docs/architecture.md`.

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// A UTF-16 code unit is at most three UTF-8 bytes, and a surrogate pair four,
// so this never reserves too little.
const WIDEST = 3;

export class Runs {
  #bytes: Uint8Array;
  #at: Uint32Array;
  // Empty and absent differ, and a pair of offsets only says empty.
  #some: Uint8Array;
  #spare = new Uint8Array(0);
  #filled = 0;

  constructor(rows: number, guess = 8) {
    this.#bytes = new Uint8Array(rows * guess);
    this.#at = new Uint32Array(rows + 1);
    this.#some = new Uint8Array((rows + 7) >> 3);
  }

  push(value: string | null): void {
    const at = this.#filled++;
    let end = this.#at[at] as number;
    if (value !== null) {
      this.#some[at >> 3] = (this.#some[at >> 3] as number) | (1 << (at & 7));
      this.#fit(end + value.length * WIDEST);
      end = this.#write(value, end);
    }
    this.#at[at + 1] = end;
  }

  // Latin text is a byte a character and goes straight in; anything else goes
  // through a buffer kept between calls rather than a view made per string.
  #write(value: string, at: number): number {
    for (let i = 0; i < value.length; i++) {
      const one = value.charCodeAt(i);
      if (one > 0x7f) return this.#encode(value, at);
      this.#bytes[at + i] = one;
    }
    return at + value.length;
  }

  #encode(value: string, at: number): number {
    const want = value.length * WIDEST;
    if (this.#spare.length < want) this.#spare = new Uint8Array(want);
    const { written } = ENCODER.encodeInto(value, this.#spare);
    for (let i = 0; i < written; i++) {
      this.#bytes[at + i] = this.#spare[i] as number;
    }
    return at + written;
  }

  get(at: number): string | null {
    if (!((this.#some[at >> 3] as number) & (1 << (at & 7)))) return null;
    const from = this.#at[at] as number;
    return DECODER.decode(this.#bytes.subarray(from, this.#at[at + 1]));
  }

  // Doubling overshoots by up to the run's own length, which is worth giving
  // back once nothing more is coming.
  close(): void {
    this.#bytes = this.#bytes.slice(0, this.#at[this.#filled]);
  }

  #fit(want: number): void {
    if (want <= this.#bytes.length) return;
    let size = Math.max(this.#bytes.length, 1);
    while (size < want) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.#bytes);
    this.#bytes = grown;
  }
}

// The same for a column of uuids, where one stride replaces the offsets.
export class Uuids {
  static readonly WIDTH = 36;
  #bytes: Uint8Array;
  #filled = 0;

  constructor(rows: number) {
    this.#bytes = new Uint8Array(rows * Uuids.WIDTH);
  }

  // A uuid is hex and dashes, so there is nothing here the encoder is for.
  push(value: string): void {
    const at = this.#filled++ * Uuids.WIDTH;
    if (value.length !== Uuids.WIDTH) {
      throw new Error(`${value} is not ${Uuids.WIDTH} characters`);
    }
    for (let i = 0; i < Uuids.WIDTH; i++) {
      const one = value.charCodeAt(i);
      if (one > 0x7f) throw new Error(`${value} is not a uuid`);
      this.#bytes[at + i] = one;
    }
  }

  get(at: number): string {
    const from = at * Uuids.WIDTH;
    return DECODER.decode(this.#bytes.subarray(from, from + Uuids.WIDTH));
  }
}
