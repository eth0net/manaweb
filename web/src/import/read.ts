import {
  COPIES,
  earlier,
  LOTS,
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
  NEEDED,
} from "./formats";

// A row nothing can be made of, and the line it sat on.
export type Skipped = { line: number; reason: string };

export type Read = { stacks: Owned[]; skipped: Skipped[] };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /^\d+(\.\d+)?$/;
const CURRENCY = /^[a-z]{3}$/i;

// The column names alone, for naming a file's format before reading it.
export function header(text: string): string[] {
  return parse(text)[0] ?? [];
}

// todo(eth0net): identify a printing by set and collector number, for the
// exports carrying no id of their own.
export function read(
  text: string,
  format: Format,
  now = new Date().toISOString(),
): Read {
  const rows = parse(text);
  const head = rows.shift();
  if (!head) return { stacks: [], skipped: [] };

  const found = columns(head, format.binding);
  // Named as the file would have spelled them, which is what anyone looking
  // at the file can act on.
  const missing = NEEDED.filter((field) => !found.has(field))
    .map((field) => format.binding[field] ?? field)
    .join(", ");
  if (missing) {
    return {
      stacks: [],
      skipped: [{ line: 1, reason: `no ${missing} column` }],
    };
  }

  const stacks: Owned[] = [];
  const skipped: Skipped[] = [];

  rows.forEach((row, at) => {
    const line = at + 2;
    const cell = (field: Field) => (row[found.get(field) ?? -1] ?? "").trim();

    // A blank line arrives as one empty field rather than as nothing.
    if (row.length < NEEDED.length) return;

    const id = cell("scryfallId");
    if (!ID.test(id)) {
      skipped.push({ line, reason: id ? `no such print ${id}` : "no print" });
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
      scryfallId: id.toLowerCase(),
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

    stacks.push(one);
  });

  return { stacks: collapse(stacks), skipped };
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
    const into = held.find(
      (other) =>
        other.quantity + one.quantity <= COPIES &&
        lots(other).length + lots(one).length <= LOTS,
    );

    if (!into) {
      held.push(one);
      found.set(stack(one), held);
      continue;
    }

    into.quantity += one.quantity;
    into.createdAt = earlier(into.createdAt, one.createdAt);
    const all = [...lots(into), ...lots(one)];
    if (all.length > 0) into.acquisitions = all;
  }

  return [...found.values()].flat();
}

function lots(one: Owned): Acquisition[] {
  return one.acquisitions ?? [];
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
