import {
  CONDITIONS,
  COPIES,
  earlier,
  LOTS,
  type Owned,
  stack,
} from "../collection/cards";
import type { Acquisition } from "../lexicons/app/manaweb/card";
import { parse } from "./csv";

// A row nothing can be made of, and the line it sat on.
export type Skipped = { line: number; reason: string };

export type Read = { stacks: Owned[]; skipped: Skipped[] };

// A column whose absence leaves nothing to write.
const NEEDED = ["scryfall id", "foil", "quantity"];

const FINISHES: Record<string, string> = {
  normal: "nonfoil",
  foil: "foil",
  etched: "etched",
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /^\d+(\.\d+)?$/;
const CURRENCY = /^[a-z]{3}$/i;

// todo(eth0net): the binder column, which wants its containers made first.
export function read(text: string, now = new Date().toISOString()): Read {
  const rows = parse(text);
  const head = rows.shift();
  if (!head) return { stacks: [], skipped: [] };

  const column = new Map(
    head.map((name, at) => [name.trim().toLowerCase(), at]),
  );
  const missing = NEEDED.filter((name) => !column.has(name));
  if (missing.length > 0) {
    return {
      stacks: [],
      skipped: [{ line: 1, reason: `no ${missing.join(", ")} column` }],
    };
  }

  const stacks: Owned[] = [];
  const skipped: Skipped[] = [];

  rows.forEach((row, at) => {
    const line = at + 2;
    const cell = (name: string) => (row[column.get(name) ?? -1] ?? "").trim();

    // A blank line arrives as one empty field rather than as nothing.
    if (row.length < NEEDED.length) return;

    const id = cell("scryfall id");
    if (!ID.test(id)) {
      skipped.push({ line, reason: id ? `no such print ${id}` : "no print" });
      return;
    }

    const foil = cell("foil");
    const finish = FINISHES[foil.toLowerCase()];
    if (!finish) {
      skipped.push({ line, reason: `unknown finish ${foil || "(blank)"}` });
      return;
    }

    const quantity = Number(cell("quantity"));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > COPIES) {
      skipped.push({ line, reason: `${cell("quantity")} is not a count` });
      return;
    }

    const one: Owned = {
      scryfallId: id.toLowerCase(),
      finish,
      quantity,
      createdAt: added(cell("added"), now),
    };

    const grade = condition(cell("condition"));
    if (grade) one.condition = grade;

    const labels = tags(cell("altered"), cell("misprint"));
    if (labels.length > 0) one.tags = labels;

    const lot = acquisition(
      quantity,
      cell("purchase price"),
      cell("purchase price currency"),
    );
    if (lot) one.acquisitions = [lot];

    stacks.push(one);
  });

  return { stacks: collapse(stacks), skipped };
}

// Bulk commons repeat, and every row folded here is a PDS write that never has
// to happen. Crossing a ceiling leaves two stacks, as amending one does.
function collapse(rows: Owned[]): Owned[] {
  const found = new Map<string, Owned[]>();

  for (const one of rows) {
    const key = stack(one);
    const held = found.get(key) ?? [];
    const into = held.find(
      (other) =>
        other.quantity + one.quantity <= COPIES &&
        lots(other).length + lots(one).length <= LOTS,
    );

    if (!into) {
      held.push(one);
      found.set(key, held);
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

// ManaBox writes the Cardmarket scale in snake case.
function condition(text: string): string | undefined {
  const grade = text
    .toLowerCase()
    .replace(/_(.)/g, (_, ch: string) => ch.toUpperCase());
  return CONDITIONS.includes(grade) ? grade : undefined;
}

function tags(altered: string, misprint: string): string[] {
  const labels: string[] = [];
  if (altered.toLowerCase() === "true") labels.push("altered");
  if (misprint.toLowerCase() === "true") labels.push("misprint");
  return labels;
}

// Left alone the column holds the market price of the day the row was added,
// which no import can tell from a figure someone typed. A sum with no currency
// beside it is not a figure, so it waits for a source that names one.
function acquisition(
  quantity: number,
  price: string,
  currency: string,
): Acquisition | undefined {
  if (!MONEY.test(price) || !CURRENCY.test(currency)) return undefined;
  return {
    quantity,
    marketValue: price,
    marketCurrency: currency.toUpperCase(),
  };
}

// When the row entered ManaBox, which for a collection entered in one session
// is one timestamp across all of it rather than when anything was bought.
function added(text: string, now: string): string {
  const when = Date.parse(text);
  return Number.isNaN(when) ? now : new Date(when).toISOString();
}
