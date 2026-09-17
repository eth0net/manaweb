import { type Locate, printKey } from "../catalog";
import {
  COPIES,
  joins,
  merge,
  NOTE,
  type Owned,
  stack,
  TAG,
  TAGS,
} from "../collection/cards";
import type { Acquisition } from "../lexicons/app/manaweb/card";
import { parse } from "./csv";
import {
  type Binding,
  type Field,
  type Format,
  finish,
  flag,
  grade,
  key,
  needed,
} from "./formats";

// A row nothing can be made of, and the line it sat on.
export type Skipped = { line: number; reason: string };

export type Read = { stacks: Owned[]; skipped: Skipped[] };

// A row named by set and number, held for one pass of the catalog rather than
// a lookup each.
type Waiting = { one: Owned; line: number; key: string; said: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /^\d+(\.\d+)?$/;
const CURRENCY = /^[a-z]{3}$/i;

// The column names alone, for naming a file's format before reading it.
export function header(text: string): string[] {
  return parse(text)[0] ?? [];
}

export function read(
  text: string,
  format: Format,
  now = new Date().toISOString(),
  locate?: Locate,
): Read {
  const rows = parse(text);
  const head = rows.shift();
  if (!head) return { stacks: [], skipped: [] };

  const wanted = needed(format.binding);
  const found = columns(head, format.binding);
  // Named as the file would have spelled them, which is what anyone looking
  // at the file can act on.
  const missing = wanted
    .filter((field) => !found.has(field))
    .map((field) => format.binding[field] ?? field)
    .join(", ");
  if (missing) {
    return {
      stacks: [],
      skipped: [{ line: 1, reason: `no ${missing} column` }],
    };
  }

  let stacks: Owned[] = [];
  const skipped: Skipped[] = [];
  const waiting: Waiting[] = [];

  rows.forEach((row, at) => {
    const line = at + 2;
    const cell = (field: Field) => (row[found.get(field) ?? -1] ?? "").trim();

    // A blank line arrives as one empty field rather than as nothing.
    if (row.length < wanted.length) return;

    const named = naming(cell, format.binding);
    if (!named) {
      skipped.push({ line, reason: "no print" });
      return;
    }
    if (named.id && !ID.test(named.id)) {
      skipped.push({ line, reason: `no such print ${named.id}` });
      return;
    }

    const how = finish(cell("finish"));
    if (!how) {
      skipped.push({ line, reason: `unknown finish ${cell("finish")}` });
      return;
    }

    const quantity = Number(cell("quantity"));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > COPIES) {
      skipped.push({ line, reason: `${cell("quantity")} is not a count` });
      return;
    }

    const one: Owned = {
      scryfallId: named.id.toLowerCase(),
      finish: how,
      quantity,
      createdAt: added(cell("createdAt"), now),
    };

    const condition = grade(cell("condition"));
    if (condition) one.condition = condition;

    const labels = tags(cell);
    if (labels.length > 0) one.tags = labels;

    const note = cell("note").slice(0, NOTE);
    if (note) one.note = note;

    const lot = acquisition(quantity, cell);
    if (lot) one.acquisitions = [lot];

    if (!one.scryfallId) {
      waiting.push({ one, line, key: named.key, said: named.said });
    }
    stacks.push(one);
  });

  if (waiting.length > 0) {
    const ids =
      locate?.(new Set(waiting.map((row) => row.key))) ??
      new Map<string, string>();
    const lost = new Set<Owned>();

    for (const row of waiting) {
      const id = ids.get(row.key);
      if (id) row.one.scryfallId = id;
      else {
        lost.add(row.one);
        skipped.push({ line: row.line, reason: `no such print ${row.said}` });
      }
    }

    stacks = stacks.filter((one) => !lost.has(one));
    skipped.sort((a, b) => a.line - b.line);
  }

  return { stacks: collapse(stacks), skipped };
}

// How this row names its printing: an id to use as it stands, or a key for
// the catalog to answer and the spelling to report if it doesn't.
function naming(
  cell: (field: Field) => string,
  binding: Binding,
): { id: string; key: string; said: string } | undefined {
  if (binding.scryfallId) {
    const id = cell("scryfallId");
    return id ? { id, key: "", said: id } : undefined;
  }

  const set = cell("setCode");
  const number = cell("collectorNumber");
  if (!set || !number) return undefined;
  return { id: "", key: printKey(set, number), said: `${set} ${number}` };
}

// Where each bound field sits in a row, for the columns the file turns out to
// carry.
function columns(head: string[], binding: Binding): Map<Field, number> {
  const at = new Map(head.map((name, index) => [key(name), index]));
  const found = new Map<Field, number>();

  for (const [field, column] of Object.entries(binding)) {
    if (!column) continue;
    const index = at.get(key(column));
    if (index !== undefined) found.set(field as Field, index);
  }
  return found;
}

// Bulk commons repeat, and every row folded here is a PDS write that never has
// to happen. Crossing a ceiling leaves two stacks, as amending one does.
function collapse(rows: Owned[]): Owned[] {
  const found = new Map<string, Owned[]>();

  for (const one of rows) {
    const held = found.get(stack(one)) ?? [];
    const at = held.findIndex((other) => joins(other, one));
    const into = at < 0 ? undefined : held[at];

    if (into) held[at] = merge(into, one);
    else held.push(one);
    found.set(stack(one), held);
  }

  return [...found.values()].flat();
}

function tags(cell: (field: Field) => string): string[] {
  const labels = new Set<string>();
  if (flag(cell("altered"))) labels.add("altered");
  if (flag(cell("misprint"))) labels.add("misprint");

  for (const one of cell("tags").split(",")) {
    const label = one.trim().slice(0, TAG);
    if (label) labels.add(label);
  }
  return [...labels].slice(0, TAGS);
}

// A sum with no currency beside it is not a figure, so it waits for a column
// that names one.
function acquisition(
  quantity: number,
  cell: (field: Field) => string,
): Acquisition | undefined {
  const lot: Acquisition = { quantity };

  if (money(cell("price"), cell("currency"))) {
    lot.price = cell("price");
    lot.currency = cell("currency").toUpperCase();
  }
  if (money(cell("marketValue"), cell("marketCurrency"))) {
    lot.marketValue = cell("marketValue");
    lot.marketCurrency = cell("marketCurrency").toUpperCase();
  }

  return lot.price || lot.marketValue ? lot : undefined;
}

function money(amount: string, currency: string): boolean {
  return MONEY.test(amount) && CURRENCY.test(currency);
}

// When the row entered the tool it came from, which for a collection entered in
// one session is one timestamp across all of it rather than a purchase date.
function added(text: string, now: string): string {
  const when = Date.parse(text);
  return Number.isNaN(when) ? now : new Date(when).toISOString();
}
