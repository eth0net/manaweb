// The printings file, held as one array per column rather than an object per
// row. Positional rows cost five or six times their own bytes once parsed,
// and every column a query filters on is already an integer — see
// `docs/architecture.md`. The strings sit beside them in one run each, read
// out by index.

import type { PrintRow, PrintTables } from ".";
import { chunks, count, split } from "./rows";
import { Runs, Uuids } from "./strings";

// Rows enough to keep the parse worthwhile and few enough that what they
// allocate is collectable while the file is still being read.
const BATCH = 4096;

// A column too narrow for its own table wraps rather than failing, so each
// says what it can take. The two bitmasks are the tight ones: a byte is eight
// entries there, not 255.
function fits(name: string, held: number, most: number): void {
  if (held > most) throw new Error(`${held} ${name} exceed ${most}`);
}

export class PrintColumns {
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

  #ids: Uuids;
  #numbers: Runs;
  // 2% of printings carry one, so a map beats a column of nulls.
  #printedNames: Map<number, string>;
  #filled = 0;

  constructor(rows: number, tables: PrintTables) {
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
    this.#ids = new Uuids(rows);
    // Digits mostly, with room for a star or the set code The List prefixes.
    this.#numbers = new Runs(rows, 5);
    this.#printedNames = new Map();
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
