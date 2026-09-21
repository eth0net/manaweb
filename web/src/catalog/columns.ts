// The printings file, held as one array per column rather than an object per
// row. Positional rows cost five or six times their own bytes once parsed,
// and every column a query filters on is already an integer — see
// `docs/architecture.md`. The strings sit beside them in one run each, read
// out by index.

import type { PrintFile, PrintRow } from ".";

// A column too narrow for its own table wraps rather than failing, so each
// says what it can take. The two bitmasks are the tight ones: a byte is eight
// entries there, not 255.
function fits(name: string, held: number, most: number): void {
  if (held > most) throw new Error(`${held} ${name} exceed ${most}`);
}

export class PrintColumns {
  readonly rows: number;
  readonly set: Uint16Array;
  readonly finishes: Uint8Array;
  readonly rarity: Uint8Array;
  readonly layout: Uint8Array;
  readonly imageStatus: Uint8Array;
  readonly lang: Uint8Array;
  readonly flags: Uint8Array;
  // No artist is 0xffff, there being no negative index to spare.
  readonly artist: Uint16Array;

  // Every id is a 36-character uuid, so one stride replaces an offset array.
  static readonly ID = 36;
  #ids: string;
  #numbers: string;
  #numberAt: Uint32Array;
  // 2% of printings carry one, so a map beats a column of nulls.
  #printedNames: Map<number, string>;

  // Filled a batch at a time, so the rows a batch parsed can go before the
  // next one arrives.
  #idParts: string[] = [];
  #numberParts: string[] = [];
  #filled = 0;

  constructor(rows: number, tables?: Omit<PrintFile, "prints">) {
    if (tables) {
      fits("sets", tables.sets.length, 0xffff);
      // 0xffff is the artist a printing does not name.
      fits("artists", tables.artists.length, 0xfffe);
      fits("rarities", tables.rarities.length, 0xff);
      fits("layouts", tables.layouts.length, 0xff);
      fits("image statuses", tables.imageStatuses.length, 0xff);
      fits("finishes", tables.finishes.length, 8);
      fits("print flags", tables.flags.length, 8);
    }

    this.rows = rows;
    this.set = new Uint16Array(rows);
    this.finishes = new Uint8Array(rows);
    this.rarity = new Uint8Array(rows);
    this.layout = new Uint8Array(rows);
    this.imageStatus = new Uint8Array(rows);
    this.lang = new Uint8Array(rows);
    this.flags = new Uint8Array(rows);
    this.artist = new Uint16Array(rows);
    this.#numberAt = new Uint32Array(rows + 1);
    this.#printedNames = new Map();
    this.#ids = "";
    this.#numbers = "";
  }

  static of(
    rows: PrintRow[],
    tables?: Omit<PrintFile, "prints">,
  ): PrintColumns {
    const held = new PrintColumns(rows.length, tables);
    held.take(rows);
    return held.close();
  }

  take(rows: PrintRow[]): void {
    let at = this.#numberAt[this.#filled] as number;
    for (const row of rows) {
      const i = this.#filled++;
      if (i >= this.rows) throw new Error(`more printings than ${this.rows}`);
      if (row[0].length !== PrintColumns.ID) {
        throw new Error(`printing ${i} has a ${row[0].length}-character id`);
      }
      this.#idParts.push(row[0]);
      this.set[i] = row[1];
      this.#numberParts.push(row[2]);
      at += row[2].length;
      this.#numberAt[i + 1] = at;
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
    this.#ids = this.#idParts.join("");
    this.#numbers = this.#numberParts.join("");
    this.#idParts = [];
    this.#numberParts = [];
    return this;
  }

  // Held as one run each, so reading one out allocates. Every caller that
  // does it in a loop is a scan the comment above it calls one-off.
  id(at: number): string {
    return this.#ids.substr(at * PrintColumns.ID, PrintColumns.ID);
  }

  number(at: number): string {
    return this.#numbers.slice(
      this.#numberAt[at] as number,
      this.#numberAt[at + 1] as number,
    );
  }

  printedName(at: number): string | null {
    return this.#printedNames.get(at) ?? null;
  }
}
