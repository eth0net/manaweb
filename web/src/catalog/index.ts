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
type CardRow = [
  oracleId: string,
  name: string,
  typeLine: string | null,
  manaCost: string | null,
  cmc: number | null,
  colors: string | null,
  colorIdentity: string,
  kind: number,
  printings: number,
  edhrecRank: number | null,
  stats: string | null,
  flags: number,
];

type PrintRow = [
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

interface CardFile {
  version: string;
  fields: string[];
  kinds: string[];
  flags: string[];
  cards: CardRow[];
}

// Every integer column on a print row indexes one of these, commonest first.
interface PrintFile {
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
  prints: PrintRow[];
}

export type SetRow = [
  code: string,
  name: string,
  kind: string,
  released: string,
];

// Collector numbers aren't numbers: 10 follows 9, "329★" follows "329", and
// The List prefixes them with a set code.
const COLLECTOR = new Intl.Collator(undefined, { numeric: true });

// Rows are positional, so a column read at the wrong index is plausible data.
const CARD_FIELDS = [
  "oracleId",
  "name",
  "typeLine",
  "manaCost",
  "cmc",
  "colors",
  "colorIdentity",
  "kind",
  "printings",
  "edhrecRank",
  "stats",
  "flags",
];

const PRINT_FIELDS = [
  "id",
  "set",
  "collectorNumber",
  "finishes",
  "rarity",
  "layout",
  "imageStatus",
  "lang",
  "printedName",
  "artist",
  "flags",
];

export interface Card {
  index: number;
  oracleId: string;
  name: string;
  typeLine: string | null;
  // Empty and absent differ: a land's cost is empty and a colorless card's
  // colors are, where a reversible card has neither, they being on its faces.
  manaCost: string | null;
  cmc: number | null;
  colors: string | null;
  colorIdentity: string;
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

function columns(file: string, held: string[], read: string[]) {
  if (held.join() !== read.join()) {
    throw new Error(
      `${file} holds ${held.join()}, this client reads ${read.join()}`,
    );
  }
}

// A bitmask against the list the file names it with.
function decode(mask: number, names: string[]): string[] {
  return names.filter((_, bit) => mask & (1 << bit));
}

export class Catalog {
  readonly version: string;
  #cards: CardFile;
  #prints: PrintFile;
  // Where each card's run of printings starts, with the total on the end.
  #offsets: Int32Array;
  #index: Index;
  // A bit per entry of the prints file's `langs`, all 19 in one integer.
  #languages: Int32Array;
  // How many printings each set holds, tallied on the same pass.
  #setSizes: Int32Array;

  constructor(cards: CardFile, prints: PrintFile) {
    if (cards.version !== prints.version) {
      throw new Error(
        `catalog halves disagree: ${cards.version} and ${prints.version}`,
      );
    }

    columns("cards", cards.fields, CARD_FIELDS);
    columns("prints", prints.fields, PRINT_FIELDS);

    // A shift is taken modulo 32, so a 32nd language would alias onto the first.
    if (prints.langs.length > 31) {
      throw new Error(`${prints.langs.length} languages exceed a bitmask`);
    }

    this.version = cards.version;
    this.#cards = cards;
    this.#prints = prints;

    this.#offsets = new Int32Array(cards.cards.length + 1);
    let offset = 0;
    for (let i = 0; i < cards.cards.length; i++) {
      this.#offsets[i] = offset;
      offset += (cards.cards[i] as CardRow)[8];
    }
    this.#offsets[cards.cards.length] = offset;

    // A total that disagrees would shift every card past the first bad one.
    if (offset !== prints.prints.length) {
      throw new Error(
        `catalog claims ${offset} printings and holds ${prints.prints.length}`,
      );
    }

    this.#languages = new Int32Array(cards.cards.length);
    this.#setSizes = new Int32Array(prints.sets.length);
    for (let card = 0; card < cards.cards.length; card++) {
      let langs = 0;
      const end = this.#offsets[card + 1] as number;
      for (let at = this.#offsets[card] as number; at < end; at++) {
        const row = prints.prints[at] as PrintRow;
        langs |= 1 << row[7];
        this.#setSizes[row[1]] = (this.#setSizes[row[1]] as number) + 1;
      }
      this.#languages[card] = langs;
    }

    this.#index = {
      names: cards.cards.map((row) => normalize(row[1])),
      kinds: cards.cards.map((row) => row[7]),
      scores: scores(
        cards.cards.map((row) => row[9]),
        cards.cards.map((row) => row[8]),
      ),
      kindCount: cards.kinds.length,
    };
  }

  get cards(): number {
    return this.#cards.cards.length;
  }

  get printings(): number {
    return this.#prints.prints.length;
  }

  // Every language some printing is in, commonest first.
  get languages(): string[] {
    return this.#prints.langs;
  }

  // A language narrows to cards printed in it, which is not searching by a
  // name in that language: "Counterspell" with `ja` finds 対抗呪文.
  search(query: string, { limit = 50, lang = "" } = {}): Card[] {
    const bit = lang ? this.#prints.langs.indexOf(lang) : -1;
    const keep =
      bit < 0
        ? undefined
        : (card: number) =>
            ((this.#languages[card] as number) >> bit) % 2 === 1;

    return search(this.#index, query, limit, keep).map((index) =>
      this.card(index),
    );
  }

  card(index: number): Card {
    const row = this.#cards.cards[index];
    if (!row) throw new RangeError(`no card ${index}`);
    return {
      index,
      oracleId: row[0],
      name: row[1],
      typeLine: row[2],
      manaCost: row[3],
      cmc: row[4],
      colors: row[5],
      colorIdentity: row[6],
      kind: this.#cards.kinds[row[7]] as string,
      printings: row[8],
      edhrecRank: row[9],
      stats: row[10],
      flags: decode(row[11], this.#cards.flags),
    };
  }

  // How many of the given printings each set holds, by code. One scan rather
  // than an index: a collection is small and this is asked once per change.
  bySet(ids: Iterable<string>): Map<string, number> {
    const wanted = ids instanceof Set ? ids : new Set(ids);
    const tally = new Map<string, number>();
    if (wanted.size === 0) return tally;

    for (const row of this.#prints.prints) {
      if (!wanted.has(row[0])) continue;
      const set = this.#prints.sets[row[1]] as SetRow;
      tally.set(set[0], (tally.get(set[0]) ?? 0) + 1);
    }
    return tally;
  }

  // Print ids for `set/collectorNumber` keys, which is what an import has to
  // go on when the file carries none. No two printings share a pair.
  locate(keys: Set<string>): Map<string, string> {
    const found = new Map<string, string>();
    if (keys.size === 0) return found;

    for (const row of this.#prints.prints) {
      const set = this.#prints.sets[row[1]] as SetRow;
      const key = printKey(set[0], row[2]);
      if (keys.has(key)) found.set(key, row[0]);
    }
    return found;
  }

  // The card and printing behind each of the given ids, in one scan as above.
  resolve(ids: Iterable<string>): Map<string, { card: Card; print: Print }> {
    const wanted = ids instanceof Set ? ids : new Set(ids);
    const found = new Map<string, { card: Card; print: Print }>();
    if (wanted.size === 0) return found;

    for (let at = 0; at < this.#prints.prints.length; at++) {
      const row = this.#prints.prints[at] as PrintRow;
      if (!wanted.has(row[0])) continue;
      found.set(row[0], {
        card: this.card(this.#owner(at)),
        print: this.#print(row),
      });
    }
    return found;
  }

  // Every set with a paper printing, and how many each holds.
  sets(): { set: SetRow; printings: number }[] {
    return this.#prints.sets.map((set, at) => ({
      set,
      printings: this.#setSizes[at] as number,
    }));
  }

  // Every printing in one set, in collector number order, with the card each
  // belongs to. A scan of the whole file, which is a couple of milliseconds
  // and beats an index built at load for a question most visits never ask.
  setPrints(code: string): { card: number; print: Print }[] {
    const set = this.#prints.sets.findIndex((one) => one[0] === code);
    if (set < 0) return [];

    const found: { card: number; print: Print }[] = [];
    for (let at = 0; at < this.#prints.prints.length; at++) {
      const row = this.#prints.prints[at] as PrintRow;
      if (row[1] === set) {
        found.push({ card: this.#owner(at), print: this.#print(row) });
      }
    }

    found.sort((a, b) =>
      COLLECTOR.compare(a.print.collectorNumber, b.print.collectorNumber),
    );
    return found;
  }

  // Which card a printing belongs to, by searching the runs rather than
  // keeping an owner per printing.
  #owner(print: number): number {
    let low = 0;
    let high = this.#cards.cards.length - 1;
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
      const print = this.#print(this.#prints.prints[i] as PrintRow);
      if (!lang || print.lang === lang) prints.push(print);
    }
    return prints;
  }

  #print(row: PrintRow): Print {
    const set = this.#prints.sets[row[1]] as PrintFile["sets"][number];
    return {
      id: row[0],
      set: set[0],
      setName: set[1],
      collectorNumber: row[2],
      finishes: decode(row[3], this.#prints.finishes),
      rarity: this.#prints.rarities[row[4]] as string,
      layout: this.#prints.layouts[row[5]] as string,
      imageStatus: this.#prints.imageStatuses[row[6]] as string,
      lang: this.#prints.langs[row[7]] as string,
      printedName: row[8],
      artist: row[9] === null ? null : (this.#prints.artists[row[9]] ?? null),
      flags: decode(row[10], this.#prints.flags),
    };
  }
}
