// Scryfall's syntax, not one of ours — see `docs/search.md` for why and for
// which terms the artifact can answer.

import { COLORS } from "./columns";
import type { Card, Print } from "./index";
import { normalize } from "./search";

export type Op = ":" | "=" | "!=" | ">" | "<" | ">=" | "<=";

export interface Term {
  key: string;
  op: Op;
  value: string;
}

// `-` negates, `or` and parentheses group; anything adjacent is an `and`.
export type Node =
  | { kind: "term"; term: Term }
  | { kind: "not"; of: Node }
  | { kind: "and"; of: Node[] }
  | { kind: "or"; of: Node[] };

// Where a term sat, so a control can replace one and leave every character
// it did not write — see `docs/search.md`.
export interface Written extends Term {
  not: boolean;
  start: number;
  end: number;
}

export interface Query {
  // The bare words, which name ranking reads rather than a term.
  text: string;
  node: Node | null;
  order: string;
  direction: "asc" | "desc" | "";
  // Recognized and unanswerable here, which is a prompt rather than an error.
  missing: string[];
  // Every term as it was typed, including the ones the tree drops.
  written: Written[];
}

// A term is a key, a comparison and a value. Anything else is part of a name.
const TERM = /^([a-z]+)(>=|<=|!=|>|<|=|:)(.*)$/i;

// Wanting a part the device doesn't hold, or a phase that hasn't arrived.
const LATER: Record<string, string> = {
  o: "oracle text",
  oracle: "oracle text",
  kw: "oracle text",
  keyword: "oracle text",
  f: "legality",
  format: "legality",
  legal: "legality",
  banned: "legality",
  restricted: "legality",
  usd: "prices",
  eur: "prices",
  tix: "prices",
};

const ORDER = [
  "name",
  "mv",
  "cmc",
  "pow",
  "tou",
  "rarity",
  "released",
  "set",
  "cn",
  "edhrec",
  "printings",
];

export interface Token {
  text: string;
  at: number;
}

interface Reading {
  tokens: Token[];
  at: number;
  words: string[];
  missing: string[];
  written: Written[];
  order: string;
  direction: "asc" | "desc" | "";
}

export function parse(text: string): Query {
  const reading: Reading = {
    tokens: tokens(text),
    at: 0,
    words: [],
    missing: [],
    written: [],
    order: "",
    direction: "",
  };

  const node = any(reading);
  return {
    text: reading.words.join(" "),
    node,
    order: reading.order,
    direction: reading.direction,
    missing: [...new Set(reading.missing)],
    written: reading.written,
  };
}

// Quotes hold a value together and parentheses stand alone; everything else
// breaks on a space.
export function tokens(text: string): Token[] {
  const found = text.matchAll(/-?\(|\)|[^\s()"]*"[^"]*"?[^\s()"]*|[^\s()]+/g);
  return [...found].map((one) => ({ text: one[0], at: one.index }));
}

function unquote(value: string): string {
  return value.replace(/"/g, "");
}

function gather(of: Node[], kind: "and" | "or"): Node | null {
  if (of.length === 0) return null;
  return of.length === 1 ? (of[0] as Node) : { kind, of };
}

// `or` binds loosest, so it is read over runs of everything else.
function any(reading: Reading): Node | null {
  const of: Node[] = [];
  for (;;) {
    const node = every(reading);
    if (node) of.push(node);
    const next = reading.tokens[reading.at];
    if (next?.text.toLowerCase() !== "or") return gather(of, "or");
    reading.at++;
  }
}

function every(reading: Reading): Node | null {
  const of: Node[] = [];
  for (;;) {
    const next = reading.tokens[reading.at];
    if (
      next === undefined ||
      next.text === ")" ||
      next.text.toLowerCase() === "or"
    ) {
      return gather(of, "and");
    }
    if (next.text.toLowerCase() === "and") {
      reading.at++;
      continue;
    }
    const node = one(reading);
    if (node) of.push(node);
  }
}

function one(reading: Reading): Node | null {
  const token = reading.tokens[reading.at++] as Token;

  if (token.text === "(" || token.text === "-(") {
    const inner = any(reading);
    // A half-typed group is the normal state — see `docs/search.md`.
    if (reading.tokens[reading.at]?.text === ")") reading.at++;
    if (!inner) return null;
    return token.text === "-(" ? { kind: "not", of: inner } : inner;
  }

  const not = token.text.startsWith("-");
  const rest = not ? token.text.slice(1) : token.text;
  const found = TERM.exec(rest);
  if (!found) {
    reading.words.push(unquote(rest));
    return null;
  }

  const [, key, op, raw] = found as unknown as string[];
  const term: Term = {
    key: (key as string).toLowerCase(),
    op: op as Op,
    value: unquote(raw as string),
  };

  reading.written.push({
    ...term,
    not,
    start: token.at,
    end: token.at + token.text.length,
  });

  if (term.key === "order") {
    if (ORDER.includes(term.value)) reading.order = term.value;
    return null;
  }
  if (term.key === "direction" || term.key === "dir") {
    reading.direction = term.value === "desc" ? "desc" : "asc";
    return null;
  }
  if (LATER[term.key]) {
    reading.missing.push(LATER[term.key] as string);
    return null;
  }
  if (!KEYS.has(term.key)) {
    // An unknown key is a name with a colon in it far less often than it is a
    // typo, so it is reported rather than searched for.
    reading.missing.push(`${term.key}:`);
    return null;
  }

  const node: Node = { kind: "term", term };
  return not ? { kind: "not", of: node } : node;
}

// Every key below, so an unknown one can be told from a supported one.
const KEYS = new Set([
  "c",
  "color",
  "colors",
  "id",
  "identity",
  "t",
  "type",
  "mv",
  "cmc",
  "manavalue",
  "m",
  "mana",
  "pow",
  "power",
  "tou",
  "toughness",
  "r",
  "rarity",
  "s",
  "set",
  "e",
  "edition",
  "cn",
  "number",
  "a",
  "artist",
  "lang",
  "in",
  "layout",
  "is",
  "not",
  "year",
]);

// Written out, and the guild and shard names players use for them.
const NAMED: Record<string, string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  colorless: "",
  c: "",
  azorius: "WU",
  dimir: "UB",
  rakdos: "BR",
  gruul: "RG",
  selesnya: "GW",
  orzhov: "WB",
  izzet: "UR",
  golgari: "BG",
  boros: "RW",
  simic: "GU",
  bant: "GWU",
  esper: "WUB",
  grixis: "UBR",
  jund: "BRG",
  naya: "RGW",
  abzan: "WBG",
  jeskai: "URW",
  sultai: "BGU",
  mardu: "RWB",
  temur: "GUR",
  // Four colors are named twice over, by the guild pattern and by the
  // nephilim, and players use both.
  glint: "UBRG",
  dune: "WBRG",
  ink: "GWUR",
  witch: "WUBG",
  yore: "WUBR",
  chaos: "UBRG",
  aggression: "WBRG",
  altruism: "GWUR",
  growth: "WUBG",
  artifice: "WUBR",
  wubrg: "WUBRG",
  five: "WUBRG",
};

const RARITY = ["common", "uncommon", "rare", "mythic"];

// `s:lea r:rare` wants one Alpha rare rather than two printings between them,
// so the whole query is put to each in turn — see `docs/search.md`.
export function matches(query: Query, card: Card, prints: Print[]): boolean {
  if (query.node === null) return true;
  if (!printed(query)) return truth(query.node, card, undefined, prints);
  return answering(query, card, prints) !== undefined;
}

// Which printing answered, and so which one a row shows.
export function answering(
  query: Query,
  card: Card,
  prints: Print[],
): Print | undefined {
  const node = query.node;
  if (node === null || !printed(query)) return undefined;
  return prints.find((print) => truth(node, card, print, prints));
}

function truth(
  node: Node,
  card: Card,
  print: Print | undefined,
  all: Print[],
): boolean {
  switch (node.kind) {
    case "term":
      return holds(node.term, card, print, all);
    case "not":
      return !truth(node.of, card, print, all);
    case "and":
      return node.of.every((one) => truth(one, card, print, all));
    default:
      return node.of.some((one) => truth(one, card, print, all));
  }
}

// Whether the printings have to be built, so a scan asking nothing of them
// doesn't pay for them.
export function printed(query: Query): boolean {
  return query.node !== null && asks(query.node);
}

function asks(node: Node): boolean {
  switch (node.kind) {
    case "term":
      return PRINTED.has(node.term.key);
    case "not":
      return asks(node.of);
    default:
      return node.of.some(asks);
  }
}

const PRINTED = new Set([
  "r",
  "rarity",
  "s",
  "set",
  "e",
  "edition",
  "cn",
  "number",
  "a",
  "artist",
  "lang",
  "in",
  "layout",
  "year",
  "is",
  "not",
]);

function holds(
  term: Term,
  card: Card,
  print: Print | undefined,
  all: Print[],
): boolean {
  const { key, op, value } = term;

  switch (key) {
    case "c":
    case "color":
    case "colors":
      // A reversible card carries none, its faces do, so it answers neither
      // way rather than reading as colorless.
      return card.colors !== null && colored(op, value, card.colors);
    case "id":
    case "identity":
      return colored(op, value, card.colorIdentity);
    case "t":
    case "type":
      return has(card.typeLine, value);
    case "mv":
    case "cmc":
    case "manavalue":
      return compares(card.cmc, Number(value), op);
    case "m":
    case "mana":
      return costs(op, value, card.manaCost);
    case "pow":
    case "power":
      return stat(card, 0, op, value);
    case "tou":
    case "toughness":
      return stat(card, 1, op, value);
    case "is":
    case "not":
      // `not:foil` is `-is:foil` spelled the other way, and the leading minus
      // is already off by the time a term is read.
      return (key === "not") !== flagged(value, card, print);
    // The one term that asks the run rather than the row.
    case "in":
      return (
        value.toLowerCase() === "paper" ||
        all.some((one) => printedAs(one, value))
      );
    case "r":
    case "rarity":
      return compares(
        RARITY.indexOf(print?.rarity ?? ""),
        RARITY.indexOf(value),
        op,
      );
    case "s":
    case "set":
    case "e":
    case "edition":
      return print?.set === value.toLowerCase();
    case "cn":
    case "number":
      return print?.collectorNumber === value;
    case "a":
    case "artist":
      return has(print?.artist ?? null, value);
    case "lang":
      return print?.lang === value.toLowerCase();
    case "layout":
      return print?.layout === value;
    case "year":
      return compares(Number(print?.released.slice(0, 4)), Number(value), op);
    default:
      return false;
  }
}

// `in:` takes a set, a rarity or a language, and none of the three shares a
// spelling with either other.
function printedAs(print: Print, value: string): boolean {
  const wanted = value.toLowerCase();
  return (
    print.set === wanted || print.rarity === wanted || print.lang === wanted
  );
}

// Symbols rather than a total, so `m>1G` is a subset relation and generic is
// counted rather than named — see `docs/search.md`.
function costs(op: Op, value: string, mine: string | null): boolean {
  if (mine === null) return false;
  const held = symbols(mine);
  const wanted = symbols(value);

  const covers = [...wanted].every(([one, n]) => (held.get(one) ?? 0) >= n);
  const inside = [...held].every(([one, n]) => (wanted.get(one) ?? 0) >= n);
  const size = (cost: Map<string, number>) =>
    [...cost.values()].reduce((all, n) => all + n, 0);

  switch (op) {
    case ">":
      return covers && size(held) > size(wanted);
    case "<":
      return inside && size(held) < size(wanted);
    case "<=":
      return inside;
    case "!=":
      return !(covers && inside);
    case "=":
      return covers && inside;
    default:
      return covers;
  }
}

// `{2}{W}{U}` as written, or the `3WU` shorthand a query is typed in.
function symbols(cost: string): Map<string, number> {
  const held = new Map<string, number>();
  const add = (one: string, n = 1) => held.set(one, (held.get(one) ?? 0) + n);

  const braced = [...cost.matchAll(/\{([^}]+)\}/g)].map(
    (found) => found[1] as string,
  );
  const parts =
    braced.length > 0 ? braced : (cost.match(/\d+|[a-z/]/gi) ?? []);

  for (const part of parts) {
    const generic = Number(part);
    if (Number.isFinite(generic)) add("generic", generic);
    else add(part.toUpperCase());
  }
  return held;
}

function has(field: string | null, value: string): boolean {
  return field !== null && normalize(field).includes(normalize(value));
}

const FINISHES = ["nonfoil", "foil", "etched"];

// `is:foil` asks a printing, everything else a flag either of them carries.
// The artifact names those in camel case and nobody types `is:fullArt`.
function flagged(
  value: string,
  card: Card,
  print: Print | undefined,
): boolean {
  const wanted = value.toLowerCase();
  if (FINISHES.includes(wanted)) {
    return print?.finishes.includes(wanted) ?? false;
  }

  const same = (flag: string) => flag.toLowerCase() === wanted;
  return card.flags.some(same) || (print?.flags.some(same) ?? false);
}

// `pow>tou` compares the two rather than a number, and a power that isn't a
// number — Tarmogoyf's `*` — matches nothing rather than counting as zero.
function stat(card: Card, at: number, op: Op, value: string): boolean {
  const parts = card.stats?.split("/") ?? [];
  const mine = Number(parts[at]);
  if (!Number.isFinite(mine)) return false;

  const other =
    value === "pow" || value === "power"
      ? Number(parts[0])
      : value === "tou" || value === "toughness"
        ? Number(parts[1])
        : Number(value);

  return compares(mine, other, op);
}

function compares(mine: number | null, other: number, op: Op): boolean {
  if (mine === null || !Number.isFinite(mine) || !Number.isFinite(other)) {
    return false;
  }
  switch (op) {
    case ">":
      return mine > other;
    case "<":
      return mine < other;
    case ">=":
      return mine >= other;
    case "!=":
      return mine !== other;
    case "<=":
      return mine <= other;
    default:
      return mine === other;
  }
}

// A color is a bit, in the order the cards file's header names them.
export function bits(letters: string): number {
  let mask = 0;
  for (const one of letters) mask |= 1 << COLORS.indexOf(one);
  return mask;
}

function many(mask: number): number {
  let held = 0;
  for (let bit = mask; bit !== 0; bit &= bit - 1) held++;
  return held;
}

// `c:` is "at least", which is what makes it the useful default; `c=2` counts
// colors instead of naming them.
function colored(op: Op, value: string, mine: number): boolean {
  const count = Number(value);
  if (Number.isFinite(count) && value.trim() !== "") {
    return compares(many(mine), count, op);
  }

  if (value.toLowerCase() === "m" || value.toLowerCase() === "multicolor") {
    return many(mine) > 1;
  }

  const wanted = masked(value);
  if (wanted === null) return false;
  if (wanted === 0) return nothing(op, mine);

  const covers = (mine & wanted) === wanted;
  const inside = (mine & ~wanted) === 0;

  switch (op) {
    case ":":
    case ">=":
      return covers;
    case ">":
      return covers && many(mine) > many(wanted);
    case "<=":
      return inside;
    case "<":
      return inside && many(mine) < many(wanted);
    case "!=":
      return !(covers && inside);
    default:
      return covers && inside;
  }
}

// Colorless is the empty set, so every operator is spelled out rather than
// falling out of subset and superset — see `docs/search.md`.
function nothing(op: Op, mine: number): boolean {
  switch (op) {
    case ">=":
      return true;
    case ">":
    case "!=":
      return mine !== 0;
    case "<":
      return false;
    default:
      return mine === 0;
  }
}

// Null where the value names no colors at all, which asks for nothing rather
// than for colorless.
function masked(value: string): number | null {
  const named = NAMED[value.toLowerCase()];
  if (named !== undefined) return bits(named);
  const found = [...value.toUpperCase()].filter((one) => COLORS.includes(one));
  return found.length > 0 && found.length === [...value].length
    ? bits(found.join(""))
    : null;
}
