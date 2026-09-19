// The query string is the state and a control a view over it, reading its
// term through the parser and editing by span — see `docs/search.md`.

import { parse, type Token, tokens, type Written } from "./catalog/query";

// Every spelling of a key, canonical first: a control has to see what was
// typed and not only what it writes.
export const KEY = {
  colors: ["c", "color", "colors"],
  identity: ["id", "identity"],
  type: ["t", "type"],
  set: ["s", "set", "e", "edition"],
  lang: ["lang"],
  order: ["order"],
  dir: ["dir", "direction"],
} as const;

export type Key = string | readonly string[];

// Which values a control owns, so two of them can share a key without taking
// each other's terms out.
export type Shape = "any" | "count" | "letters";

export interface Held {
  op: string;
  values: string[];
  // `c>=2 c<=4` is one key holding two of them — see `docs/search.md`.
  terms: { op: string; value: string }[];
}

export interface Picking {
  op?: string;
  not?: boolean;
  shape?: Shape;
  // Separate terms rather than an `or` group, which is how a query says every
  // one of them rather than any.
  all?: boolean;
}

function spellings(key: Key): readonly string[] {
  return typeof key === "string" ? [key] : key;
}

// The spelling a control writes, of however many it reads.
export function canonical(key: Key): string {
  return typeof key === "string" ? key : (key[0] as string);
}

function fits(value: string, shape: Shape): boolean {
  if (shape === "count") return /^\d+$/.test(value);
  if (shape === "letters") return value !== "" && !/^\d/.test(value);
  return true;
}

function owned(term: Written, key: Key, { not, shape }: Picking): boolean {
  return (
    spellings(key).includes(term.key) &&
    term.not === (not ?? false) &&
    fits(term.value, shape ?? "any")
  );
}

function mine(text: string, key: Key, how: Picking): Written[] {
  return parse(text).written.filter((term) => owned(term, key, how));
}

export function read(text: string, key: Key, how: Picking = {}): Held {
  const found = mine(text, key, how);
  return {
    op: found[0]?.op ?? ":",
    values: found.map((term) => term.value),
    terms: found.map((term) => ({ op: term.op, value: term.value })),
  };
}

export function value(text: string, key: Key): string {
  return read(text, key).values[0] ?? "";
}

// What the chip wrote, replaced by what it now says. Another polarity, another
// shape and everything typed around them are left where they are.
export function write(
  text: string,
  key: Key,
  wanted: string[],
  how: Picking = {},
) {
  return join(remove(text, key, how), compose(key, wanted, how));
}

// The two halves of a write, for a control writing more than one run of terms
// over the same key.
export function remove(text: string, key: Key, how: Picking = {}): string {
  return cut(text, mine(text, key, how));
}

export function compose(
  key: Key,
  wanted: string[],
  { op = ":", not = false, all = false }: Picking = {},
): string {
  if (wanted.length === 0) return "";
  const name = canonical(key);
  const minus = not ? "-" : "";
  const terms = wanted.map((each) => `${minus}${name}${op}${quoted(each)}`);
  if (terms.length === 1) return terms[0] as string;
  return all ? terms.join(" ") : `(${terms.join(" or ")})`;
}

export function join(...parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

export function one(text: string, key: Key, wanted: string, op = ":") {
  return write(text, key, wanted ? [wanted] : [], { op });
}

// A cut can leave a dangling `or`, an empty group or a group of one, so the
// tidy-up reads the tokens either side of the hole — see `docs/search.md`.
function cut(text: string, terms: Written[]): string {
  const all = tokens(text);
  const gone = all.map((token) =>
    terms.some((term) => term.start === token.at),
  );

  while (dangling(all, gone) || bracketed(all, gone)) {
    // Each pass can expose the next: emptying a group leaves its `or` bare.
  }

  return rejoin(all.filter((_, at) => !gone[at]));
}

function live(all: Token[], gone: boolean[], from: number, step: number) {
  for (let at = from + step; at >= 0 && at < all.length; at += step) {
    if (!gone[at]) return all[at] as Token;
  }
  return undefined;
}

function joins(token: Token | undefined): boolean {
  const word = token?.text.toLowerCase();
  return word === "or" || word === "and";
}

// An `or` with a group edge or another `or` on either side of it.
function dangling(all: Token[], gone: boolean[]): boolean {
  let cut = false;
  for (const [at, token] of all.entries()) {
    if (gone[at] || !joins(token)) continue;
    const before = live(all, gone, at, -1);
    const after = live(all, gone, at, 1);
    if (
      before === undefined ||
      before.text.endsWith("(") ||
      joins(before) ||
      after === undefined ||
      after.text === ")"
    ) {
      gone[at] = true;
      cut = true;
    }
  }
  return cut;
}

// A group holding nothing goes, and one holding a single term sheds its
// parentheses. A negated group keeps them, the `-` being on the bracket.
function bracketed(all: Token[], gone: boolean[]): boolean {
  const open: number[] = [];
  let cut = false;

  for (const [at, token] of all.entries()) {
    if (gone[at]) continue;
    if (token.text.endsWith("(")) {
      open.push(at);
      continue;
    }
    if (token.text !== ")") continue;

    const from = open.pop();
    if (from === undefined) continue;
    const inside = all.filter(
      (_, one) => one > from && one < at && !gone[one],
    );
    const alone =
      inside.length === 1 &&
      !(inside[0] as Token).text.endsWith("(") &&
      (all[from] as Token).text === "(";
    if (inside.length === 0 || alone) {
      gone[from] = true;
      gone[at] = true;
      cut = true;
    }
  }
  return cut;
}

// Canonical spacing, which is all the original had once a term left it.
function rejoin(kept: Token[]): string {
  return kept.reduce((text, token, at) => {
    const last = kept[at - 1];
    if (last === undefined) return token.text;
    if (last.text.endsWith("(") || token.text === ")")
      return text + token.text;
    return `${text} ${token.text}`;
  }, "");
}

// A value with a space in it is one value, which only quotes can say.
function quoted(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}
