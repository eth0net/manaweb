// A file is one JSON document whose rows are its last key, so the header can
// be read without the array behind it and the array in pieces — see
// `docs/architecture.md`.
//
// Scanned as bytes: every byte of a multi-byte character is above 0x7f, so a
// quote or bracket found here is always the real one.

const QUOTE = 34;
const BACKSLASH = 92;
const OPEN = 91;
const CLOSE = 93;
const BRACE = 125;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export interface Split {
  header: string;
  rows: Uint8Array;
}

// The writer puts the array last and closes with `]}`, which is what makes
// the split a slice rather than a parse.
export function split(bytes: Uint8Array, name: string): Split {
  const mark = ENCODER.encode(`,"${name}":[`);
  const at = last(bytes, mark);
  if (at < 0) throw new Error(`no ${name} array in the file`);
  if (bytes[bytes.length - 2] !== CLOSE || bytes[bytes.length - 1] !== BRACE) {
    throw new Error(`${name} file does not end ]}`);
  }
  return {
    header: `${DECODER.decode(bytes.subarray(0, at))}}`,
    rows: bytes.subarray(at + mark.length, bytes.length - 2),
  };
}

// The last one, the array being the last key: an earlier match would be a
// header string that happens to read the same.
function last(bytes: Uint8Array, mark: Uint8Array): number {
  for (let at = bytes.length - mark.length; at >= 0; at--) {
    if (here(bytes, at, mark)) return at;
  }
  return -1;
}

function here(bytes: Uint8Array, at: number, mark: Uint8Array): boolean {
  for (let i = 0; i < mark.length; i++) {
    if (bytes[at + i] !== mark[i]) return false;
  }
  return true;
}

// Where the row starting at `from` ends, or -1 past the last. A generator
// here costs an object per row, which is the allocation this file exists to
// avoid.
function ends(bytes: Uint8Array, from: number): number {
  let depth = 0;
  let quoted = false;

  for (let at = from; at < bytes.length; at++) {
    const one = bytes[at];
    if (quoted) {
      if (one === BACKSLASH) at++;
      else if (one === QUOTE) quoted = false;
    } else if (one === QUOTE) {
      quoted = true;
    } else if (one === OPEN) {
      depth++;
    } else if (one === CLOSE && --depth === 0) {
      return at + 1;
    }
  }
  return -1;
}

// How many rows, without building one.
export function count(bytes: Uint8Array): number {
  let held = 0;
  for (let at = 0; at < bytes.length; ) {
    const end = ends(bytes, at);
    if (end < 0) break;
    held++;
    at = end + 1;
  }
  return held;
}

// The rows in batches, so no more than `each` of them exist at a time, and
// only a batch is ever decoded. One yield per batch rather than per row, for
// the same reason.
export function* chunks<T>(bytes: Uint8Array, each: number): Generator<T[]> {
  let from = 0;
  let held = 0;
  let at = 0;

  while (at < bytes.length) {
    const end = ends(bytes, at);
    if (end < 0) break;
    held++;
    at = end + 1;
    if (held === each) {
      yield batch<T>(bytes, from, end);
      from = at;
      held = 0;
    }
  }
  if (held > 0) yield batch<T>(bytes, from, bytes.length);
}

function batch<T>(bytes: Uint8Array, from: number, to: number): T[] {
  return JSON.parse(`[${DECODER.decode(bytes.subarray(from, to))}]`) as T[];
}
