// A file is one JSON document whose rows are its last key, so the header can
// be read without the array behind it and the array in pieces — see
// `docs/architecture.md`.

const QUOTE = 34;
const BACKSLASH = 92;
const OPEN = 91;
const CLOSE = 93;

export interface Split {
  header: string;
  rows: string;
}

// The writer puts the array last and closes with `]}`, which is what makes
// the split a slice rather than a parse.
export function split(text: string, name: string): Split {
  const mark = `,"${name}":[`;
  const at = text.lastIndexOf(mark);
  if (at < 0) throw new Error(`no ${name} array in the file`);
  if (!text.endsWith("]}")) throw new Error(`${name} file does not end ]}`);
  return {
    header: `${text.slice(0, at)}}`,
    rows: text.slice(at + mark.length, -2),
  };
}

// Where the row starting at `from` ends, or -1 past the last. A generator
// here costs an object per row, which is the allocation this file exists to
// avoid.
export function ends(text: string, from: number): number {
  let depth = 0;
  let quoted = false;

  for (let at = from; at < text.length; at++) {
    const one = text.charCodeAt(at);
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
export function count(text: string): number {
  let held = 0;
  for (let at = 0; at < text.length; ) {
    const end = ends(text, at);
    if (end < 0) break;
    held++;
    at = end + 1;
  }
  return held;
}

// The rows in batches, so no more than `each` of them exist at a time. One
// yield per batch rather than per row, for the same reason.
export function* chunks<T>(text: string, each: number): Generator<T[]> {
  let from = 0;
  let held = 0;
  let at = 0;

  while (at < text.length) {
    const end = ends(text, at);
    if (end < 0) break;
    held++;
    at = end + 1;
    if (held === each) {
      yield JSON.parse(`[${text.slice(from, end)}]`) as T[];
      from = at;
      held = 0;
    }
  }
  if (held > 0) yield JSON.parse(`[${text.slice(from)}]`) as T[];
}
