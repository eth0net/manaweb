import { CardColumns, PrintColumns } from "./columns";
import { matches, printed, type Query } from "./query";
import { type Index, normalize, scores, search } from "./search";

// `name` resolves against the manifest's own URL, so the catalog can move.
export interface Entry {
  name: string;
  rows: number;
  bytes: number;
}

// Fetched first, and the only part re-fetched: the files are immutable.
export interface Manifest {
  version: string;
  cards: Entry;
  prints: Entry;
}

// Positional rows, in the order each file's own `fields` names them. Kept
// raw: only what reaches the screen is materialized.
export type CardRow = [
  oracleId: string,
  name: string,
  typeLine: string | null,
  manaCost: string | null,
  cmc: number | null,
  colors: number | null,
  colorIdentity: number,
  kind: number,
  printings: number,
  edhrecRank: number | null,
  stats: string | null,
  flags: number,
];

export type PrintRow = [
  id: string,
  set: number,
  collectorNumber: string,
  finishes: number,
  rarity: number,
  layout: number,
  imageStatus: number,
  lang: number,
  printedName: string | null,
  artist: number | null,
  flags: number,
];

// A file's header, which is everything in it but the rows.
export interface CardTables {
  version: string;
  fields: string[];
  kinds: string[];
  // The bit each color takes in the two color columns.
  colors: string[];
  flags: string[];
}

// Every integer column on a print row indexes one of these, commonest first.
export interface PrintTables {
  version: string;
  fields: string[];
  finishes: string[];
  flags: string[];
  rarities: string[];
  layouts: string[];
  imageStatuses: string[];
  langs: string[];
  artists: string[];
  sets: SetRow[];
}

export type SetRow = [
  code: string,
  name: string,
  kind: string,
  released: string,
];

// Nothing to ask the printings, which most queries don't.
const NONE: Print[] = [];

// Common to mythic, which is what makes `r>=rare` an order rather than a name.
const RARITY = ["common", "uncommon", "rare", "mythic"];

// A power or toughness that isn't a number sorts last rather than as zero.
function stat(card: Card, at: number): number {
  const found = Number(card.stats?.split("/")[at]);
  return Number.isFinite(found) ? found : Number.MAX_SAFE_INTEGER;
}

// Unranked is least played rather than most — see `docs/search.md`.
function rank(card: Card): number {
  return card.edhrecRank ?? Number.MAX_SAFE_INTEGER;
}

// Collector numbers aren't numbers: 10 follows 9, "329★" follows "329", and
// The List prefixes them with a set code.
const COLLECTOR = new Intl.Collator(undefined, { numeric: true });

export interface Card {
  index: number;
  oracleId: string;
  name: string;
  typeLine: string | null;
  // Empty and absent differ: a land's cost is empty and a colorless card's
  // colors are, where a reversible card has neither, they being on its faces.
  manaCost: string | null;
  cmc: number | null;
  colors: number | null;
  colorIdentity: number;
  kind: string;
  printings: number;
  // Lower is more played. Absent for tokens, art series and basic lands.
  edhrecRank: number | null;
  // `3/3`, or a loyalty or defense alone. The type line says which.
  stats: string | null;
  // Named by the file, so a flag the artifact gains needs nothing here.
  flags: string[];
}

export interface Print {
  id: string;
  set: string;
  setName: string;
  // The set's day, which is the only date a printing has.
  released: string;
  collectorNumber: string;
  finishes: string[];
  rarity: string;
  layout: string;
  imageStatus: string;
  lang: string;
  printedName: string | null;
  artist: string | null;
  // What makes this copy not the plain one.
  flags: string[];
}

// How a file with no print ids names a printing, spelled the same on both
// sides of a lookup.
export function printKey(set: string, collectorNumber: string): string {
  return `${set}/${collectorNumber}`.toLowerCase();
}

// One pass of the catalog answering every key an import is waiting on.
export type Locate = (keys: Set<string>) => Map<string, string>;

// Hotlinked from the id, so no URL is stored. Nothing is behind it when
// `imageStatus` is `missing` or `placeholder`.
//
// todo(faces): a two-faced card has a back under `/back/`, and the detail view
// has no way to turn one over — `docs/scryfall.md`.
export function image(id: string, size = "normal"): string {
  return `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg`;
}

// Tengwar sits in the Private Use Area, so no font on the device has it.
const PRIVATE_USE = /[\u{E000}-\u{F8FF}]/u;

export function readable(name: string | null): string | null {
  return name && !PRIVATE_USE.test(name) ? name : null;
}

// Browser tags aren't Scryfall's codes, and only Chinese splits in two.
export function appLanguage(tag = navigator.language): string {
  const parts = tag.toLowerCase().split("-");
  const base = parts[0] as string;
  if (base !== "zh") return base;
  const rest = parts.slice(1);
  return rest.includes("hant") || rest.includes("tw") || rest.includes("hk")
    ? "zht"
    : "zhs";
}

// A card's name as read, and the language that name is in — the printing's
// only when its own printed name is what's shown.
export function cardName(
  oracle: string,
  print: Pick<Print, "lang" | "printedName"> | undefined,
  app: string,
): { text: string; lang: string } {
  if (print?.lang === app) {
    const printed = readable(print.printedName);
    if (printed) return { text: printed, lang: print.lang };
  }
  // Scryfall keeps the oracle name in English whatever the printing is, so
  // this is the readable answer for a Phyrexian card as much as a Japanese
  // one someone would rather read in English.
  return { text: oracle, lang: "en" };
}

// Codes with no standard name, checked against the printings using them.
const LANGUAGES: Record<string, string> = {
  ph: "Phyrexian",
  qya: "Quenya",
  zhs: "Chinese (Simplified)",
  zht: "Chinese (Traditional)",
};

// Falls back to the code: the artifact carries whatever Scryfall does.
export function language(code: string): string {
  const known = LANGUAGES[code];
  if (known) return known;
  try {
    const names = new Intl.DisplayNames(undefined, {
      type: "language",
      fallback: "none",
    });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

// A camelCase name from the artifact as something to put on screen.
export function words(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

// A bitmask against the list the file names it with.
function decode(mask: number, names: string[]): string[] {
  return names.filter((_, bit) => mask & (1 << bit));
}

export class Catalog {
  readonly version: string;
  #cards: CardColumns;
  #prints: PrintColumns;
  // Where each card's run of printings starts, with the total on the end.
  #offsets: Int32Array;
  #index: Index;
  // A bit per entry of the prints file's `langs`, all 19 in one integer.
  #languages: Int32Array;
  // How many printings each set holds, tallied on the same pass.
  #setSizes: Int32Array;

  // The files as fetched, each read a batch at a time so its parsed form
  // never exists whole beside the columns it becomes — see
  // `docs/architecture.md`.
  static read(cards: Uint8Array, prints: Uint8Array): Catalog {
    return new Catalog(CardColumns.read(cards), PrintColumns.read(prints));
  }

  constructor(cards: CardColumns, prints: PrintColumns) {
    const version = cards.tables.version;
    if (version !== prints.tables.version) {
      throw new Error(
        `catalog halves disagree: ${version} and ${prints.tables.version}`,
      );
    }

    this.version = version;
    this.#cards = cards;
    this.#prints = prints;

    this.#offsets = new Int32Array(cards.rows + 1);
    let offset = 0;
    for (let i = 0; i < cards.rows; i++) {
      this.#offsets[i] = offset;
      offset += cards.printings[i] as number;
    }
    this.#offsets[cards.rows] = offset;

    // A total that disagrees would shift every card past the first bad one.
    if (offset !== this.#prints.rows) {
      throw new Error(
        `catalog claims ${offset} printings and holds ${this.#prints.rows}`,
      );
    }

    this.#languages = new Int32Array(cards.rows);
    this.#setSizes = new Int32Array(prints.tables.sets.length);
    for (let card = 0; card < cards.rows; card++) {
      let langs = 0;
      const end = this.#offsets[card + 1] as number;
      for (let at = this.#offsets[card] as number; at < end; at++) {
        langs |= 1 << (this.#prints.lang[at] as number);
        const set = this.#prints.set[at] as number;
        this.#setSizes[set] = (this.#setSizes[set] as number) + 1;
      }
      this.#languages[card] = langs;
    }

    const names: string[] = new Array(cards.rows);
    for (let card = 0; card < cards.rows; card++) {
      names[card] = normalize(cards.name(card));
    }
    this.#index = {
      names,
      kinds: cards.kind,
      scores: scores(cards.edhrecRank, cards.printings),
      kindCount: cards.tables.kinds.length,
    };
  }

  get cards(): number {
    return this.#cards.rows;
  }

  get printings(): number {
    return this.#prints.rows;
  }

  // Every subtype any card carries, which no column names: a type line is
  // supertypes and types, then an em dash, then these.
  #kinds: string[] | null = null;

  subtypes(): string[] {
    if (this.#kinds) return this.#kinds;

    const found = new Set<string>();
    for (let card = 0; card < this.#cards.rows; card++) {
      const line = this.#cards.typeLine(card);
      if (line === null) continue;
      for (const face of line.split("//")) {
        const after = face.split("—")[1];
        for (const word of after?.trim().split(/\s+/) ?? []) found.add(word);
      }
    }

    this.#kinds = [...found].sort((a, b) => a.localeCompare(b));
    return this.#kinds;
  }

  // Every language some printing is in, commonest first.
  get languages(): string[] {
    return this.#prints.tables.langs;
  }

  // Names are ranked; terms only narrow — see `docs/search.md`. A query with
  // no name at all is the whole catalog walked instead, which an order makes
  // worth reading.
  find(query: Query, { limit = 50 } = {}): Card[] {
    // Nothing asked is nothing found, which is what an empty box shows and
    // what a query of only unanswerable terms comes to.
    if (!query.text && query.node === null) return [];

    const wants = printed(query);
    const keep =
      query.node === null
        ? undefined
        : (card: number) =>
            matches(query, this.card(card), wants ? this.prints(card) : NONE);

    // An order sorts everything that matched, so the cap comes off the scan
    // and goes on what is handed back.
    const cap = query.order ? this.#cards.rows : limit;
    const found = query.text
      ? search(this.#index, query.text, cap, keep)
      : this.#walk(keep, cap);

    const cards = found.map((index) => this.card(index));
    if (!query.order) return cards;

    cards.sort(this.#by(query.order));
    if (query.direction === "desc") cards.reverse();
    return cards.slice(0, limit);
  }

  // Rows arrive by name, so a walk that sorts nothing is already alphabetical.
  #walk(keep: ((card: number) => boolean) | undefined, cap: number): number[] {
    const found: number[] = [];
    const cards = this.#cards.rows;
    for (let card = 0; card < cards && found.length < cap; card++) {
      if (!keep || keep(card)) found.push(card);
    }
    return found;
  }

  // The printing a sort over sets or rarity reads, which is the one its row
  // already shows.
  #first(card: Card): Print | undefined {
    return this.prints(card.index)[0];
  }

  #by(order: string): (a: Card, b: Card) => number {
    switch (order) {
      case "mv":
      case "cmc":
        return (a, b) => (a.cmc ?? 0) - (b.cmc ?? 0);
      case "pow":
        return (a, b) => stat(a, 0) - stat(b, 0);
      case "tou":
        return (a, b) => stat(a, 1) - stat(b, 1);
      case "printings":
        return (a, b) => b.printings - a.printings;
      case "edhrec":
        return (a, b) => rank(a) - rank(b);
      case "released":
        return (a, b) =>
          (this.#first(b)?.released ?? "").localeCompare(
            this.#first(a)?.released ?? "",
          );
      case "rarity":
        return (a, b) =>
          RARITY.indexOf(this.#first(a)?.rarity ?? "") -
          RARITY.indexOf(this.#first(b)?.rarity ?? "");
      case "set":
        return (a, b) =>
          (this.#first(a)?.set ?? "").localeCompare(this.#first(b)?.set ?? "");
      case "cn":
        return (a, b) =>
          COLLECTOR.compare(
            this.#first(a)?.collectorNumber ?? "",
            this.#first(b)?.collectorNumber ?? "",
          );
      default:
        return (a, b) => a.name.localeCompare(b.name);
    }
  }

  card(index: number): Card {
    const cols = this.#cards;
    if (index < 0 || index >= cols.rows) {
      throw new RangeError(`no card ${index}`);
    }
    const cmc = cols.cmc[index] as number;
    const colors = cols.colors[index] as number;
    const rank = cols.edhrecRank[index] as number;
    return {
      index,
      oracleId: cols.oracleId(index),
      name: cols.name(index),
      typeLine: cols.typeLine(index),
      manaCost: cols.manaCost(index),
      cmc: Number.isNaN(cmc) ? null : cmc,
      colors: colors === CardColumns.NO_COLORS ? null : colors,
      colorIdentity: cols.colorIdentity[index] as number,
      kind: cols.tables.kinds[cols.kind[index] as number] as string,
      printings: cols.printings[index] as number,
      edhrecRank: rank === CardColumns.UNRANKED ? null : rank,
      stats: cols.stats(index),
      flags: decode(cols.flags[index] as number, cols.tables.flags),
    };
  }

  // How many of the given printings each set holds, by code. One scan rather
  // than an index: a collection is small and this is asked once per change.
  bySet(ids: Iterable<string>): Map<string, number> {
    const wanted = ids instanceof Set ? ids : new Set(ids);
    const tally = new Map<string, number>();
    if (wanted.size === 0) return tally;

    const cols = this.#prints;
    for (let at = 0; at < cols.rows; at++) {
      if (!wanted.has(cols.id(at))) continue;
      const set = cols.tables.sets[cols.set[at] as number] as SetRow;
      tally.set(set[0], (tally.get(set[0]) ?? 0) + 1);
    }
    return tally;
  }

  // Print ids for `set/collectorNumber` keys, which is what an import has to
  // go on when the file carries none. No two printings share a pair.
  locate(keys: Set<string>): Map<string, string> {
    const found = new Map<string, string>();
    if (keys.size === 0) return found;

    const cols = this.#prints;
    for (let at = 0; at < cols.rows; at++) {
      const set = cols.tables.sets[cols.set[at] as number] as SetRow;
      const key = printKey(set[0], cols.number(at));
      if (keys.has(key)) found.set(key, cols.id(at));
    }
    return found;
  }

  // The card and printing behind each of the given ids, in one scan as above.
  resolve(ids: Iterable<string>): Map<string, { card: Card; print: Print }> {
    const wanted = ids instanceof Set ? ids : new Set(ids);
    const found = new Map<string, { card: Card; print: Print }>();
    if (wanted.size === 0) return found;

    for (let at = 0; at < this.#prints.rows; at++) {
      const id = this.#prints.id(at);
      if (!wanted.has(id)) continue;
      found.set(id, {
        card: this.card(this.#owner(at)),
        print: this.#print(at),
      });
    }
    return found;
  }

  // Every set with a paper printing, and how many each holds.
  sets(): { set: SetRow; printings: number }[] {
    return this.#prints.tables.sets.map((set, at) => ({
      set,
      printings: this.#setSizes[at] as number,
    }));
  }

  // Every printing in these sets, newest set first and in collector number
  // order within one, with the card each belongs to. A scan of the whole file,
  // which is a couple of milliseconds and beats an index built at load for a
  // question most visits never ask.
  setPrints(codes: string[]): { card: number; print: Print }[] {
    const rank = new Map(
      this.#prints.tables.sets
        .filter((set) => codes.includes(set[0]))
        .sort((a, b) => b[3].localeCompare(a[3]))
        .map((set, at) => [set[0], at] as const),
    );
    if (rank.size === 0) return [];

    const found: { card: number; print: Print }[] = [];
    const cols = this.#prints;
    for (let at = 0; at < cols.rows; at++) {
      const set = cols.tables.sets[cols.set[at] as number] as SetRow;
      if (rank.has(set[0])) {
        found.push({ card: this.#owner(at), print: this.#print(at) });
      }
    }

    found.sort(
      (a, b) =>
        (rank.get(a.print.set) as number) -
          (rank.get(b.print.set) as number) ||
        COLLECTOR.compare(a.print.collectorNumber, b.print.collectorNumber),
    );
    return found;
  }

  // Which card a printing belongs to, by searching the runs rather than
  // keeping an owner per printing.
  #owner(print: number): number {
    let low = 0;
    let high = this.#cards.rows - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.#offsets[mid] as number) <= print) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  // Every paper printing, in the order search shows them.
  prints(index: number, lang = ""): Print[] {
    const start = this.#offsets[index];
    const end = this.#offsets[index + 1];
    if (start === undefined || end === undefined) {
      throw new RangeError(`no card ${index}`);
    }

    const prints: Print[] = [];
    for (let i = start; i < end; i++) {
      const print = this.#print(i);
      if (!lang || print.lang === lang) prints.push(print);
    }
    return prints;
  }

  #print(at: number): Print {
    const cols = this.#prints;
    const tables = cols.tables;
    const set = tables.sets[cols.set[at] as number] as SetRow;
    const artist = cols.artist[at] as number;
    return {
      id: cols.id(at),
      set: set[0],
      setName: set[1],
      released: set[3],
      collectorNumber: cols.number(at),
      finishes: decode(cols.finishes[at] as number, tables.finishes),
      rarity: tables.rarities[cols.rarity[at] as number] as string,
      layout: tables.layouts[cols.layout[at] as number] as string,
      imageStatus: tables.imageStatuses[
        cols.imageStatus[at] as number
      ] as string,
      lang: tables.langs[cols.lang[at] as number] as string,
      printedName: cols.printedName(at),
      artist: artist === 0xffff ? null : (tables.artists[artist] ?? null),
      flags: decode(cols.flags[at] as number, tables.flags),
    };
  }
}
