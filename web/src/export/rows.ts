import { type Owned, type Stack, shown } from "../collection/cards";
import {
  columns,
  type Field,
  type Format,
  flagged,
  foil,
  graded,
  key,
} from "../import/formats";
import { UNREAD } from "../import/read";
import type { Acquisition } from "../lexicons/app/manaweb/card";

// What a printing says about itself, which is everything a row carries that
// the record does not. `Catalog.resolve` answers this shape.
export type Printing = {
  card: { name: string };
  print: {
    set: string;
    setName: string;
    collectorNumber: string;
    rarity: string;
    lang: string;
  };
};

export type Describe = (ids: Iterable<string>) => Map<string, Printing>;

export type Written = {
  rows: string[][];
  // Copies whose printing the catalog cannot name, so the row carries the id
  // and nothing else about the card.
  unnamed: number;
  // What these cards say that this format has no column for.
  dropped: Field[];
  // Copies whose finish this format has no word for. The row goes out as the
  // record holds it and reads back as nothing, so it is counted here.
  unspelled: number;
  // Copies saying something a row carries but a read cannot put back:
  // `docs/scryfall.md` names each.
  unkept: number;
  // What this file says that reading it back would not restore.
  unread: Field[];
};

// 10 follows 9 and "329★" follows "329", so a collector number orders as text
// that happens to start with a number. Pinned to one locale, or two devices
// write the same collection two ways.
const ORDER = new Intl.Collator("en", { numeric: true });

// One lot of copies and the row carrying them.
type Lot = { quantity: number; lot?: Acquisition };

export function rows(
  stacks: Stack[],
  format: Format,
  describe: Describe,
  places: Map<string, string> = new Map(),
): Written {
  const held = describe(new Set(stacks.map((one) => one.value.scryfallId)));
  const head = columns(format);
  const at = new Map(head.map((column, index) => [key(column), index]));
  const out: string[][] = [head];
  let unnamed = 0;
  let unspelled = 0;
  let unkept = 0;

  for (const one of sorted(stacks, held)) {
    const count = shown(one);
    if (count < 1) continue;

    const printing = held.get(one.value.scryfallId);
    if (!printing) unnamed += count;
    if (!foil(one.value.finish)) unspelled += count;
    if (vague(one.value, format)) unkept += count;

    for (const lot of split(count, one.value.acquisitions ?? [])) {
      const row = new Array<string>(head.length).fill("");
      for (const [field, column] of Object.entries(format.binding)) {
        const index = at.get(key(column));
        if (index !== undefined) {
          row[index] = cell(field as Field, one.value, printing, lot, places);
        }
      }
      out.push(row);
    }
  }

  return {
    rows: out,
    unnamed,
    unspelled,
    unkept,
    dropped: dropped(stacks, format),
    unread: unread(stacks, format),
  };
}

// Records come back in whatever order they were written, which no export
// should inherit. Anything the catalog cannot name sorts last.
function sorted(stacks: Stack[], held: Map<string, Printing>): Stack[] {
  return [...stacks].sort((a, b) => {
    const one = held.get(a.value.scryfallId)?.print;
    const other = held.get(b.value.scryfallId)?.print;
    if (!one || !other) return one ? -1 : other ? 1 : 0;
    return (
      one.set.localeCompare(other.set) ||
      ORDER.compare(one.collectorNumber, other.collectorNumber) ||
      a.value.finish.localeCompare(b.value.finish) ||
      (a.value.condition ?? "").localeCompare(b.value.condition ?? "")
    );
  });
}

// One row per lot, capped at the copies held, and a lot counting none of them
// spends none — `docs/scryfall.md`.
function split(count: number, acquisitions: Acquisition[]): Lot[] {
  const lots: Lot[] = [];
  let left = count;

  for (const lot of acquisitions) {
    if (left < 1) break;
    const quantity = Math.min(Math.trunc(lot.quantity), left);
    if (quantity < 1) continue;
    lots.push({ quantity, lot });
    left -= quantity;
  }

  if (left > 0) lots.push({ quantity: left });
  return lots;
}

function cell(
  field: Field,
  one: Owned,
  printing: Printing | undefined,
  lot: Lot,
  places: Map<string, string>,
): string {
  switch (field) {
    case "scryfallId":
      return one.scryfallId;
    case "name":
      return printing?.card.name ?? "";
    case "setCode":
      return printing?.print.set.toUpperCase() ?? "";
    case "setName":
      return printing?.print.setName ?? "";
    case "collectorNumber":
      return printing?.print.collectorNumber ?? "";
    case "rarity":
      return printing?.print.rarity ?? "";
    case "language":
      return printing?.print.lang ?? "";
    case "finish":
      return foil(one.finish) ?? one.finish;
    case "quantity":
      return String(lot.quantity);
    case "condition":
      return one.condition ? graded(one.condition) : "";
    case "container":
      return one.container ? (places.get(one.container) ?? "") : "";
    case "altered":
      return flagged(labeled(one, "altered"));
    case "misprint":
      return flagged(labeled(one, "misprint"));
    case "tags":
      return (one.tags ?? []).join(",");
    case "note":
      return one.note ?? "";
    case "proxy":
      return flagged(one.proxy ?? false);
    case "price":
      return lot.lot?.price ?? "";
    case "currency":
      return lot.lot?.currency ?? "";
    case "marketValue":
      return lot.lot?.marketValue ?? "";
    case "marketCurrency":
      return lot.lot?.marketCurrency ?? "";
    case "acquiredAt":
      return lot.lot?.at ?? "";
    case "createdAt":
      return one.createdAt;
    case "updatedAt":
      return one.updatedAt ?? "";
  }
}

// What a row carries that a read makes less of — `docs/scryfall.md` names
// the three.
function vague(one: Owned, format: Format): boolean {
  const tagged =
    format.binding.tags !== undefined &&
    (one.tags ?? []).some((label) => label.includes(","));

  return (
    tagged ||
    (one.acquisitions ?? []).some(
      (lot) =>
        (lot.price !== undefined && lot.currency === undefined) ||
        (lot.marketValue !== undefined && lot.marketCurrency === undefined) ||
        (lot.price === undefined &&
          lot.marketValue === undefined &&
          lot.at === undefined),
    )
  );
}

// A column written and not read is only a loss where a card fills it.
function unread(stacks: Stack[], format: Format): Field[] {
  return UNREAD.filter(
    (field) =>
      format.binding[field] !== undefined &&
      stacks.some((one) => one.value[field] !== undefined),
  );
}

function labeled(one: Owned, label: string): boolean {
  return (one.tags ?? []).includes(label);
}

// What the file will not say, named before it is written rather than found
// missing afterwards.
function dropped(stacks: Stack[], format: Format): Field[] {
  const { binding } = format;
  const held = (field: Field) => binding[field] !== undefined;
  const any = (said: (one: Owned) => boolean) =>
    stacks.some((one) => said(one.value));

  const lost: Field[] = [];
  if (!held("container") && any((one) => one.container !== undefined)) {
    lost.push("container");
  }
  if (!held("note") && any((one) => one.note !== undefined)) lost.push("note");
  if (!held("proxy") && any((one) => one.proxy === true)) lost.push("proxy");
  if (any((one) => (one.tags ?? []).some((label) => !kept(label, held)))) {
    lost.push("tags");
  }
  if (!held("price") && any((one) => lots(one).some((lot) => lot.price))) {
    lost.push("price");
  }
  return lost;
}

// A label with a column of its own survives a format carrying no tags.
function kept(label: string, held: (field: Field) => boolean): boolean {
  if (held("tags")) return true;
  return (
    (label === "altered" && held("altered")) ||
    (label === "misprint" && held("misprint"))
  );
}

function lots(one: Owned): Acquisition[] {
  return one.acquisitions ?? [];
}
