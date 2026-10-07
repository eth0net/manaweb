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
import { legible, UNREAD } from "../import/read";
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
  // Lots the copies ran out before, so no row says what they cost or when.
  unspent: number;
  // What this file says that reading it back would not restore.
  unread: Field[];
  // Copies in a language this format's own importer turns down.
  refused: number;
};

// What an export was asked for beyond the rows themselves.
export type Writing = {
  // Containers by their record's URI, for a format with a column for one.
  places?: Map<string, string>;
  // Say English where the vendor refuses the true language. Theirs says the
  // same of those printings — `docs/scryfall.md`.
  english?: boolean;
};

// What a row needs that is neither the record nor the printing.
type How = { places: Map<string, string>; lang: string };

// 10 follows 9 and "329★" follows "329", so a collector number orders as text
// that happens to start with a number. Pinned to one locale, or two devices
// write the same collection two ways.
const ORDER = new Intl.Collator("en", { numeric: true });

// One lot of copies and the row carrying them.
type Lot = { quantity: number; lot?: Acquisition };

// The copies a stack puts in the file, and the lots none were left for.
type Spent = { lots: Lot[]; unspent: number };

export function rows(
  stacks: Stack[],
  format: Format,
  describe: Describe,
  { places = new Map(), english = false }: Writing = {},
): Written {
  const held = describe(new Set(stacks.map((one) => one.value.scryfallId)));
  const head = columns(format);
  const at = new Map(head.map((column, index) => [key(column), index]));
  const out: string[][] = [head];
  let unnamed = 0;
  let unspelled = 0;
  let unkept = 0;
  let unspent = 0;
  let refused = 0;

  for (const one of sorted(stacks, held)) {
    const count = shown(one);
    if (count < 1) continue;

    const printing = held.get(one.value.scryfallId);
    if (!printing) unnamed += count;
    if (!foil(one.value.finish)) unspelled += count;
    if (vague(one.value, format)) unkept += count;

    const said = printing?.print.lang ?? "";
    const turned = format.refuses?.includes(said) ?? false;
    if (turned) refused += count;
    const lang = turned && english ? "en" : said;

    const spent = split(count, one.value.acquisitions ?? [], format);
    unspent += spent.unspent;

    for (const lot of spent.lots) {
      const row = new Array<string>(head.length).fill("");
      for (const [field, column] of Object.entries(format.binding)) {
        const index = at.get(key(column));
        if (index !== undefined) {
          row[index] = cell(field as Field, one.value, printing, lot, {
            places,
            lang,
          });
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
    unspent,
    refused,
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
function split(
  count: number,
  acquisitions: Acquisition[],
  format: Format,
): Spent {
  const lots: Lot[] = [];
  let left = count;
  let unspent = 0;

  for (const lot of acquisitions) {
    // Before the copies are weighed, or the same record would count one way
    // written in one order and another in the other.
    const whole = Math.trunc(lot.quantity);
    if (whole < 1) continue;

    if (left < 1) {
      if (carried(lot, format)) unspent += 1;
      continue;
    }

    const quantity = Math.min(whole, left);
    lots.push({ quantity, lot });
    left -= quantity;
  }

  if (left > 0) lots.push({ quantity: left });
  return { lots, unspent };
}

// What a lot says and the column a row would say it in. A currency is not
// one of them: an amount is what makes a lot — `docs/scryfall.md`.
const SAID: [Field, (lot: Acquisition) => string | undefined][] = [
  ["price", (lot) => lot.price],
  ["marketValue", (lot) => lot.marketValue],
  ["acquiredAt", (lot) => lot.at],
];

// A lot worth counting as lost: this file had both something to say about it
// and a column to say it in. Where the format binds neither, every lot went
// the same way and `dropped` is what names it.
function carried(lot: Acquisition, format: Format): boolean {
  return SAID.some(
    ([field, said]) =>
      format.binding[field] !== undefined && (said(lot) ?? "").trim() !== "",
  );
}

function cell(
  field: Field,
  one: Owned,
  printing: Printing | undefined,
  lot: Lot,
  how: How,
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
      return how.lang;
    case "finish":
      return foil(one.finish) ?? one.finish;
    case "quantity":
      return String(lot.quantity);
    case "condition":
      return one.condition ? graded(one.condition) : "";
    case "container":
      return one.container ? (how.places.get(one.container) ?? "") : "";
    case "altered":
      return flagged(labeled(one, "altered"));
    case "misprint":
      return flagged(labeled(one, "misprint"));
    case "signed":
      return flagged(labeled(one, "signed"));
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
// each.
function vague(one: Owned, format: Format): boolean {
  const tagged =
    format.binding.tags !== undefined &&
    (one.tags ?? []).some((label) => label.includes(","));

  return tagged || (one.acquisitions ?? []).some((lot) => !legible(lot));
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
  if (!held("acquiredAt") && any((one) => lots(one).some((lot) => lot.at))) {
    lost.push("acquiredAt");
  }
  return lost;
}

// The labels a vendor gives a column each rather than a list, named alike on
// both sides so the column is the field.
const FLAGGED: Field[] = ["altered", "misprint", "signed"];

// A label with a column of its own survives a format carrying no tags.
function kept(label: string, held: (field: Field) => boolean): boolean {
  return (
    held("tags") || (FLAGGED.includes(label as Field) && held(label as Field))
  );
}

function lots(one: Owned): Acquisition[] {
  return one.acquisitions ?? [];
}
