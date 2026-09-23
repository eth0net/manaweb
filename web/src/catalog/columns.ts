// Each file held as one array per column rather than an object per row.
// Positional rows cost five or six times their own bytes once parsed, and
// every column a query filters on is already an integer — see
// `docs/architecture.md`. The strings sit beside them in one run each, read
// out by index.

import type { CardRow, CardTables, Face, PrintRow, PrintTables } from ".";
import { chunks, count, split } from "./rows";
import { Runs, Uuids } from "./strings";

// Rows enough to keep the parse worthwhile and few enough that what they
// allocate is collectable while the file is still being read.
const BATCH = 4096;

// Bit `i` of a card's colors and color identity. The cards file names the
// same order, and is checked against this rather than trusted.
export const COLORS = "WUBRG";

// Rows are positional, so a column read at the wrong index is plausible data.
export const CARD_FIELDS = [
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
  // Named because the column after it is read, not because anything reads
  // this one: the client has no `kw:` yet.
  "keywords",
  "faces",
];

export const PRINT_FIELDS = [
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

// Read at whatever position the file names it, and absent where the file has
// none: the check below holds a file only to the columns above.
const ARTWORK = "artwork";

function fields(file: string, held: string[], read: string[]): void {
  if (held.join() !== read.join()) {
    throw new Error(
      `${file} holds ${held.join()}, this client reads ${read.join()}`,
    );
  }
}

// A prefix, not the whole list: a file is uploaded before the client reading
// it, so a column added there must not take the catalog off the one running.
function columns(file: string, held: string[], read: string[]): void {
  if (held.slice(0, read.length).join() !== read.join()) {
    throw new Error(
      `${file} holds ${held.join()}, this client reads ${read.join()}`,
    );
  }
}

// A column too narrow for its own table wraps rather than failing, so each
// says what it can take. The two bitmasks are the tight ones: a byte is eight
// entries there, not 255.
function fits(name: string, held: number, most: number): void {
  if (held > most) throw new Error(`${held} ${name} exceed ${most}`);
}

export class PrintColumns {
  static readonly NO_ARTWORK = -1;

  readonly rows: number;
  // Every integer column indexes one of these, so they travel together.
  readonly tables: PrintTables;
  readonly set: Uint16Array;
  readonly finishes: Uint8Array;
  readonly rarity: Uint8Array;
  readonly layout: Uint8Array;
  readonly imageStatus: Uint8Array;
  readonly lang: Uint8Array;
  readonly flags: Uint8Array;
  // No artist is 0xffff, there being no negative index to spare.
  readonly artist: Uint16Array;
  // -1 is the printing with no illustration of its own.
  readonly artwork: Int32Array;

  #ids: Uuids;
  #numbers: Runs;
  // 2% of printings carry one, so a map beats a column of nulls.
  #printedNames: Map<number, string>;
  // Where this file keeps the artwork column, or -1 for one without it.
  #artworkAt: number;
  #filled = 0;

  constructor(rows: number, tables: PrintTables) {
    columns("prints", tables.fields, PRINT_FIELDS);
    fits("sets", tables.sets.length, 0xffff);
    // 0xffff is the artist a printing does not name.
    fits("artists", tables.artists.length, 0xfffe);
    fits("rarities", tables.rarities.length, 0xff);
    fits("layouts", tables.layouts.length, 0xff);
    fits("image statuses", tables.imageStatuses.length, 0xff);
    fits("finishes", tables.finishes.length, 8);
    fits("print flags", tables.flags.length, 8);
    // A shift is taken modulo 32, so a 32nd language would alias onto the
    // first.
    fits("languages", tables.langs.length, 31);

    this.rows = rows;
    this.tables = tables;
    this.set = new Uint16Array(rows);
    this.finishes = new Uint8Array(rows);
    this.rarity = new Uint8Array(rows);
    this.layout = new Uint8Array(rows);
    this.imageStatus = new Uint8Array(rows);
    this.lang = new Uint8Array(rows);
    this.flags = new Uint8Array(rows);
    this.artist = new Uint16Array(rows);
    this.artwork = new Int32Array(rows);
    this.#ids = new Uuids(rows);
    // Digits mostly, with room for a star or the set code The List prefixes.
    this.#numbers = new Runs(rows, 5);
    this.#printedNames = new Map();
    this.#artworkAt = tables.fields.indexOf(ARTWORK);
  }

  // The file read straight into columns: its rows are counted, then parsed a
  // batch at a time, so the parsed form never exists whole beside them.
  static read(bytes: Uint8Array): PrintColumns {
    const held = split(bytes, "prints");
    const tables = JSON.parse(held.header) as PrintTables;
    const cols = new PrintColumns(count(held.rows), tables);
    for (const batch of chunks<PrintRow>(held.rows, BATCH)) cols.take(batch);
    return cols.close();
  }

  take(rows: PrintRow[]): void {
    for (const row of rows) {
      const i = this.#filled++;
      if (i >= this.rows) throw new Error(`more printings than ${this.rows}`);
      this.#ids.push(row[0]);
      this.set[i] = row[1];
      this.#numbers.push(row[2]);
      this.finishes[i] = row[3];
      this.rarity[i] = row[4];
      this.layout[i] = row[5];
      this.imageStatus[i] = row[6];
      this.lang[i] = row[7];
      if (row[8] !== null) this.#printedNames.set(i, row[8]);
      this.artist[i] = row[9] ?? 0xffff;
      this.flags[i] = row[10];
      const artwork =
        this.#artworkAt < 0
          ? null
          : ((row[this.#artworkAt] ?? null) as number | null);
      this.artwork[i] = artwork ?? PrintColumns.NO_ARTWORK;
    }
  }

  close(): this {
    if (this.#filled !== this.rows) {
      throw new Error(
        `${this.#filled} printings against ${this.rows} counted`,
      );
    }
    this.#numbers.close();
    return this;
  }

  // Held as bytes, so reading one out decodes it. Every caller that does it
  // in a loop is a scan the comment above it calls one-off.
  id(at: number): string {
    return this.#ids.get(at);
  }

  number(at: number): string {
    return this.#numbers.get(at) as string;
  }

  printedName(at: number): string | null {
    return this.#printedNames.get(at) ?? null;
  }
}

export class CardColumns {
  readonly rows: number;
  readonly tables: CardTables;
  // Un-cards have halves and Gleemax has a million, so this is no integer.
  // NaN is the card that carries none, a reversible one having faces instead.
  readonly cmc: Float64Array;
  // Five bits, so 0xff is the card whose colors are on its faces rather than
  // the card with none.
  readonly colors: Uint8Array;
  readonly colorIdentity: Uint8Array;
  readonly kind: Uint8Array;
  readonly printings: Int32Array;
  // -1 is unranked, which every token, art series and basic land is.
  readonly edhrecRank: Int32Array;
  readonly flags: Uint8Array;

  static readonly NO_COLORS = 0xff;
  static readonly UNRANKED = -1;

  #oracleIds: Uuids;
  #names: Runs;
  #typeLines: Runs;
  #manaCosts: Runs;
  #stats: Runs;
  // 3% of cards have two sides, so a map beats a column of nulls.
  #faces: Map<number, Face[]>;
  #filled = 0;

  constructor(rows: number, tables: CardTables) {
    columns("cards", tables.fields, CARD_FIELDS);
    // The table arrived with the bitmask, so a file without it is the older
    // format, whose colors are strings a byte column reads as zero.
    if (!tables.colors) {
      throw new Error(
        "cards file predates the color bitmask, so re-export it",
      );
    }
    fields("card colors", tables.colors, [...COLORS]);
    fits("kinds", tables.kinds.length, 0xff);
    fits("card flags", tables.flags.length, 8);

    this.rows = rows;
    this.tables = tables;
    this.cmc = new Float64Array(rows);
    this.colors = new Uint8Array(rows);
    this.colorIdentity = new Uint8Array(rows);
    this.kind = new Uint8Array(rows);
    this.printings = new Int32Array(rows);
    this.edhrecRank = new Int32Array(rows);
    this.flags = new Uint8Array(rows);
    this.#oracleIds = new Uuids(rows);
    this.#names = new Runs(rows, 20);
    this.#typeLines = new Runs(rows, 24);
    this.#manaCosts = new Runs(rows, 10);
    // A loyalty, a defense, or a power and a toughness.
    this.#stats = new Runs(rows, 4);
    this.#faces = new Map();
  }

  static read(bytes: Uint8Array): CardColumns {
    const held = split(bytes, "cards");
    const tables = JSON.parse(held.header) as CardTables;
    const cols = new CardColumns(count(held.rows), tables);
    for (const batch of chunks<CardRow>(held.rows, BATCH)) cols.take(batch);
    return cols.close();
  }

  take(rows: CardRow[]): void {
    for (const row of rows) {
      const i = this.#filled++;
      if (i >= this.rows) throw new Error(`more cards than ${this.rows}`);
      this.#oracleIds.push(row[0]);
      this.#names.push(row[1]);
      this.#typeLines.push(row[2]);
      this.#manaCosts.push(row[3]);
      this.cmc[i] = row[4] ?? Number.NaN;
      this.colors[i] = row[5] ?? CardColumns.NO_COLORS;
      this.colorIdentity[i] = row[6];
      this.kind[i] = row[7];
      this.printings[i] = row[8];
      this.edhrecRank[i] = row[9] ?? CardColumns.UNRANKED;
      this.#stats.push(row[10]);
      this.flags[i] = row[11];
      if (row[13]) {
        this.#faces.set(
          i,
          row[13].map(([name, typeLine, manaCost, colors, stats]) => ({
            name,
            typeLine,
            manaCost,
            colors,
            stats,
          })),
        );
      }
    }
  }

  close(): this {
    if (this.#filled !== this.rows) {
      throw new Error(`${this.#filled} cards against ${this.rows} counted`);
    }
    for (const run of [
      this.#names,
      this.#typeLines,
      this.#manaCosts,
      this.#stats,
    ]) {
      run.close();
    }
    return this;
  }

  oracleId(at: number): string {
    return this.#oracleIds.get(at);
  }

  name(at: number): string {
    return this.#names.get(at) as string;
  }

  typeLine(at: number): string | null {
    return this.#typeLines.get(at);
  }

  manaCost(at: number): string | null {
    return this.#manaCosts.get(at);
  }

  stats(at: number): string | null {
    return this.#stats.get(at);
  }

  faces(at: number): Face[] | null {
    return this.#faces.get(at) ?? null;
  }
}
