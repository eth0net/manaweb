// Writes an import fixture spreading over every value the card cache holds for
// the axes a printing can differ on, so a shape nobody anticipated arrives as
// a failing test rather than as a bug report.
//
//     bun run gen            rewrite it from the seed it was made with
//     bun run gen --seed x   and from a different one
//     bun run gen --check    does that seed still produce the committed file
//
// Outside `just check`: the cache is a 78MB download CI has no reason to make.

import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONDITIONS } from "../../web/src/collection/cards";
import { write } from "../../web/src/export/csv";
import {
  columns,
  type Field,
  flagged,
  foil,
  graded,
  key,
  MANABOX,
} from "../../web/src/import/formats";

process.chdir(dirname(dirname(import.meta.dir)));

const WHERE = process.env.MANAWEB_DATABASE ?? "manaweb.db";
const MADE = "web/src/import/fixtures/generated.json";

// The seed the committed fixture was drawn with and the cache version it was
// drawn from. Both are needed to reproduce it: one seed over a later cache
// picks other printings.
type Made = { file: string; seed: string; source: string };

// A collection is cards somebody could hold, so the digital-only printings the
// bulk file carries are out.
const PAPER = "c.games like '%paper%'";

// Columns whose values the cache discovers rather than this listing them: a
// Scryfall taxonomy gains entries unannounced.
const SPREAD = ["layout", "rarity", "frame", "border_color", "lang"];

// A printing either carries one of these or does not, and both are a row.
const FLAGS = ["promo", "variation", "full_art", "textless", "oversized"];

const EACH = 2;

// Enough printings of one illustration to show it crossing a set boundary.
const ARTWORKS = 3;
const PER_ARTWORK = 3;

type Printing = {
  id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  lang: string;
  finishes: string;
};

// One stream per bucket and one per printing, each seeded by its own name, so
// an axis added here leaves every row the other axes picked where it was.
function stream(name: string): () => number {
  let state = 2166136261;
  for (let at = 0; at < name.length; at++) {
    state = Math.imul(state ^ name.charCodeAt(at), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, from: T[], count: number): T[] {
  const held = [...from];
  const taken: T[] = [];
  while (taken.length < count && held.length > 0) {
    taken.push(...held.splice(Math.floor(rng() * held.length), 1));
  }
  return taken;
}

// 10 follows 9 and "329★" follows "329", the same order an export writes.
const ORDER = new Intl.Collator("en", { numeric: true });

const [seedArg, checking] = [
  process.argv.indexOf("--seed"),
  process.argv.includes("--check"),
];

const made = JSON.parse(readFileSync(MADE, "utf8")) as Made;
const name = made.file;
const given = seedArg < 0 ? made.seed : process.argv[seedArg + 1];
// Without this a bare `--seed` writes every row from the seed `undefined` and
// drops the recorded one, which the next `--check` then agrees with.
if (typeof given !== "string" || !given) {
  console.log(
    `no seed to draw from: ${seedArg < 0 ? MADE : "--seed"} has none`,
  );
  process.exit(1);
}
const seed = given;

const db = new Database(WHERE, { readonly: true });
const source = (
  db
    .query("select updated_at from bulk_sync where kind = 'default_cards'")
    .get() as { updated_at: string } | null
)?.updated_at;

if (!source) {
  console.log(`${WHERE} has never synced, so there is nothing to draw from`);
  process.exit(1);
}

if (checking && source !== made.source) {
  console.log(
    `${name} was drawn from ${made.source} and the cache is at ${source}`,
  );
  console.log("`just write-fixtures` takes the newer one");
  process.exit(1);
}

const ids = (sql: string, ...args: string[]): string[] =>
  db
    .query(sql)
    .values(...args)
    .map((row) => row[0] as string);

// Which printings to write, and the finish a row has to claim where it was
// picked for one. Everything else takes a finish of its own.
const wanted = new Map<string, string | undefined>();
const take = (bucket: string, from: string[], count: number, how?: string) => {
  for (const id of pick(stream(`${seed}:${bucket}`), from, count)) {
    if (how || !wanted.has(id)) wanted.set(id, how);
  }
};

for (const column of SPREAD) {
  for (const value of ids(
    `select distinct c.${column} from cards c where ${PAPER} order by 1`,
  )) {
    take(
      `${column}=${value}`,
      ids(
        `select c.id from cards c where ${PAPER} and c.${column} = ? order by c.id`,
        value,
      ),
      EACH,
    );
  }
}

for (const column of FLAGS) {
  for (const value of ["0", "1"]) {
    take(
      `${column}=${value}`,
      ids(
        `select c.id from cards c where ${PAPER} and c.${column} = ? order by c.id`,
        value,
      ),
      EACH,
    );
  }
}

for (const value of ids(
  `select distinct f.value from cards c, json_each(c.finishes) f where ${PAPER} order by 1`,
)) {
  take(
    `finish=${value}`,
    ids(
      `select c.id from cards c, json_each(c.finishes) f where ${PAPER} and f.value = ? order by c.id`,
      value,
    ),
    EACH,
    value,
  );
}

for (const illustration of pick(
  stream(`${seed}:artwork`),
  ids(
    `select c.illustration_id from cards c where ${PAPER} and c.illustration_id is not null
     group by c.illustration_id having count(distinct c.set_code) > 2 order by 1`,
  ),
  ARTWORKS,
)) {
  take(
    `artwork=${illustration}`,
    ids(
      `select c.id from cards c where ${PAPER} and c.illustration_id = ? order by c.set_code, c.id`,
      illustration,
    ),
    PER_ARTWORK,
  );
}

const HEAD = columns(MANABOX);
const AT = new Map(HEAD.map((column, at) => [key(column), at]));

function row(
  card: Printing,
  want: string | undefined,
): { cells: string[]; missed?: string } | null {
  const rng = stream(`${seed}:${card.id}`);
  const finishes = JSON.parse(card.finishes) as string[];
  // Drawn whether or not a bucket asked, so the cells below do not shift with
  // which bucket claimed the printing.
  const drawn = finishes[Math.floor(rng() * finishes.length)] as string;
  const how = want ?? drawn;
  // A spelling this vendor has no word for leaves the row nowhere to go, which
  // is the finish arriving rather than the fixture being wrong.
  const written = foil(how) ?? foil(finishes.find((one) => foil(one)) ?? "");
  if (!written) return null;
  const missed =
    want !== undefined && written !== foil(want) ? want : undefined;

  const out = new Array<string>(HEAD.length).fill("");
  const put = (field: Field, text: string) => {
    const at = AT.get(key(MANABOX.binding[field] ?? ""));
    if (at !== undefined) out[at] = text;
  };
  const day = new Date(
    Date.UTC(2025, 0, 1) + Math.floor(rng() * 600) * 86400000,
  );

  put("scryfallId", card.id);
  put("name", card.name);
  put("setCode", card.set_code.toUpperCase());
  put("setName", card.set_name);
  put("collectorNumber", card.collector_number);
  put("rarity", card.rarity);
  put("language", card.lang);
  put("finish", written);
  put("quantity", String(1 + Math.floor(rng() * 4)));
  put(
    "condition",
    graded(CONDITIONS[Math.floor(rng() * CONDITIONS.length)] as string),
  );
  put("altered", flagged(rng() < 0.04));
  put("misprint", flagged(rng() < 0.04));
  put("signed", flagged(rng() < 0.04));
  put("proxy", flagged(rng() < 0.02));
  put("marketValue", (rng() * 40).toFixed(2));
  put("marketCurrency", "GBP");
  put("createdAt", day.toISOString());
  return missed ? { cells: out, missed } : { cells: out };
}

const cards = db
  .query(
    `select c.id, o.name, c.set_code, c.set_name, c.collector_number, c.rarity,
            c.lang, c.finishes
     from cards c join oracle o on o.id = c.oracle_id
     where c.id in (${[...wanted.keys()].map(() => "?").join(",")})`,
  )
  .all(...wanted.keys()) as Printing[];

cards.sort(
  (a, b) =>
    a.set_code.localeCompare(b.set_code) ||
    ORDER.compare(a.collector_number, b.collector_number),
);

const rows = [HEAD];
let unspelled = 0;
const missed = new Set<string>();
for (const card of cards) {
  const written = row(card, wanted.get(card.id));
  if (!written) {
    unspelled++;
    continue;
  }
  rows.push(written.cells);
  if (written.missed) missed.add(written.missed);
}

const file = write(rows);
const at = join("web/src/import/fixtures", name);

if (checking) {
  if (file === readFileSync(at, "utf8")) {
    console.log(`${name}: ${rows.length - 1} rows, as its seed writes them`);
  } else {
    console.log(`${name} is not what seed ${seed} writes from ${source}`);
    process.exit(1);
  }
} else {
  writeFileSync(at, file);
  const next: Made = { file: name, seed, source };
  writeFileSync(MADE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${name}: ${rows.length - 1} rows from ${source}`);
  if (unspelled > 0) {
    console.log(
      `${unspelled} printings ManaBox has no word for the finish of`,
    );
  }
  if (missed.size > 0) {
    console.log(
      `written as another finish, so the fixture covers none: ${[...missed].sort().join(", ")}`,
    );
  }
}
