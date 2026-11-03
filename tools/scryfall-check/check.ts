// Holds our search to Scryfall's, whose syntax we borrowed rather than
// invented — see `docs/search.md`. Their API answers each query and ours
// answers the same one, and the two lists of names are compared.
//
//     bun run check          their answers from the last day where there are any
//     bun run check --live    every answer fetched again
//
// Not part of `just check`: it needs the network, their service and a built
// catalog, and it answers a question about our implementation rather than
// about this commit.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Catalog } from "../../web/src/catalog";
import { parse } from "../../web/src/catalog/query";

process.chdir(dirname(dirname(import.meta.dir)));

// Their guidance is 50–100ms between requests, and we are in no hurry. It is
// the whole run repeated that gets a 429 rather than any one call, so the
// answers are kept and the pause is only taken where one is fetched.
const WAIT = 120;

// A day: well inside how fast their data moves, and well outside an hour of
// changing our own half. `--live` is the run that settles anything.
const KEEP = 24 * 60 * 60 * 1000;
const ANSWERS = join(import.meta.dir, ".answers.json");

const WHERE = process.env.MANAWEB_CATALOG ?? "catalog";

// Extras and digital-only printings are ours to hold and not theirs to return,
// so both sides are narrowed to the same pile rather than diffed noisily.
const PAPER = "game:paper -is:digital";

interface Answered {
  names: Set<string>;
  truncated: boolean;
}

// One of their answers as it is kept, with when it was asked for.
interface Kept {
  names: string[];
  truncated: boolean;
  at: number;
}

function answers(): Record<string, Kept> {
  try {
    return JSON.parse(readFileSync(ANSWERS, "utf8")) as Record<string, Kept>;
  } catch {
    // Absent, or written by a version that spelled it differently.
    return {};
  }
}

function since(at: number): string {
  const hours = Math.round((Date.now() - at) / 3_600_000);
  return hours < 1 ? "under an hour" : `${hours}h`;
}

function held(): Catalog {
  const manifest = JSON.parse(
    readFileSync(join(WHERE, "manifest.json"), "utf8"),
  );
  const read = (name: string) => readFileSync(join(WHERE, name));
  return Catalog.read(read(manifest.cards.name), read(manifest.prints.name));
}

async function theirs(query: string): Promise<Answered> {
  const names = new Set<string>();
  let url =
    "https://api.scryfall.com/cards/search?unique=cards&q=" +
    encodeURIComponent(`${query} ${PAPER}`);

  for (let page = 0; page < 3; page++) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "manaweb-scryfall-check/1.0 (+https://manaweb.app)",
      },
    });

    // No results is an answer, not a failure: it means we should find none.
    if (response.status === 404) return { names, truncated: false };
    if (!response.ok) {
      throw new Error(`scryfall ${response.status} for ${query}`);
    }

    const body = (await response.json()) as {
      data: { name: string }[];
      has_more?: boolean;
      next_page?: string;
    };
    for (const card of body.data) names.add(card.name);

    if (!body.has_more || !body.next_page) return { names, truncated: false };
    url = body.next_page;
    await Bun.sleep(WAIT);
  }

  return { names, truncated: true };
}

// Ours holds tokens and art series, which their default search leaves out.
function ours(catalog: Catalog, query: string): Set<string> {
  const found = catalog.find(parse(query), { limit: 2000 });
  return new Set(
    found.filter((card) => card.kind === "card").map((card) => card.name),
  );
}

function missing(from: Set<string>, against: Set<string>): string[] {
  return [...from].filter((name) => !against.has(name)).sort();
}

function show(label: string, names: string[]): void {
  if (names.length === 0) return;
  const few = names.slice(0, 5).join(", ");
  const rest = names.length > 5 ? `, and ${names.length - 5} more` : "";
  console.log(`      ${label} ${names.length}: ${few}${rest}`);
}

const queries = readFileSync(join(import.meta.dir, "queries.txt"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

const catalog = held();
console.log(`catalog ${catalog.version}, ${queries.length} queries\n`);

const live = process.argv.includes("--live");
// What this run asked about, which after a full pass is the whole file: a
// query reworded in `queries.txt` leaves no answer behind.
const kept: Record<string, Kept> = {};
let whole = false;
const before = answers();

let differed = 0;
let asked = 0;
let oldest = Date.now();

try {
  for (const query of queries) {
    const was = live ? undefined : before[query];
    const fresh = was && Date.now() - was.at < KEEP ? was : undefined;

    let them: Answered;
    if (fresh) {
      them = { names: new Set(fresh.names), truncated: fresh.truncated };
      kept[query] = fresh;
      oldest = Math.min(oldest, fresh.at);
    } else {
      them = await theirs(query);
      kept[query] = {
        names: [...them.names],
        truncated: them.truncated,
        at: Date.now(),
      };
      asked += 1;
    }

    const us = ours(catalog, query);
    const short = missing(them.names, us);
    const extra = missing(us, them.names);
    const same = short.length === 0 && extra.length === 0;

    const note = them.truncated ? " (theirs truncated at 3 pages)" : "";
    const age = fresh ? ` (theirs ${since(fresh.at)} old)` : "";
    console.log(
      `  ${same ? "ok  " : "DIFF"}  ${query}${note}${age}\n` +
        `        theirs ${them.names.size}, ours ${us.size}`,
    );
    show("only theirs:", short);
    show("only ours:", extra);
    if (!same) differed++;

    if (!fresh) await Bun.sleep(WAIT);
  }
  whole = true;
} finally {
  // Written even where a call failed, so a run that stopped partway keeps the
  // answers it did get — and prunes nothing, not having seen every query.
  const all = whole ? kept : { ...before, ...kept };
  writeFileSync(ANSWERS, JSON.stringify(all));
}

const reused = queries.length - asked;
console.log(
  reused === 0
    ? "\nevery answer theirs just now"
    : `\n${reused} of ${queries.length} answers kept from before, oldest ${since(oldest)} — \`--live\` asks again`,
);
console.log(
  differed === 0
    ? "all green"
    : `${differed} of ${queries.length} queries differ`,
);
process.exit(differed === 0 ? 0 : 1);
