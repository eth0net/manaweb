// Holds our search to Scryfall's, whose syntax we borrowed rather than
// invented — see `docs/search.md`. Their API answers each query and ours
// answers the same one, and the two lists of names are compared.
//
//     bun run check
//
// Not part of `just check`: it needs the network, their service and a built
// catalog, and it answers a question about our implementation rather than
// about this commit.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Catalog } from "../../web/src/catalog";
import { parse } from "../../web/src/catalog/query";

process.chdir(dirname(dirname(import.meta.dir)));

// Their guidance is 50–100ms between requests, and we are in no hurry.
const WAIT = 120;

const WHERE = process.env.MANAWEB_CATALOG ?? "catalog";

// Extras and digital-only printings are ours to hold and not theirs to return,
// so both sides are narrowed to the same pile rather than diffed noisily.
const PAPER = "game:paper -is:digital";

interface Answered {
  names: Set<string>;
  truncated: boolean;
}

function held(): Catalog {
  const manifest = JSON.parse(
    readFileSync(join(WHERE, "manifest.json"), "utf8"),
  );
  const read = (name: string) =>
    JSON.parse(readFileSync(join(WHERE, name), "utf8"));
  return new Catalog(read(manifest.cards.name), read(manifest.prints.name));
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

let differed = 0;
for (const query of queries) {
  const them = await theirs(query);
  const us = ours(catalog, query);

  const short = missing(them.names, us);
  const extra = missing(us, them.names);
  const same = short.length === 0 && extra.length === 0;

  const note = them.truncated ? " (theirs truncated at 3 pages)" : "";
  console.log(
    `  ${same ? "ok  " : "DIFF"}  ${query}${note}\n` +
      `        theirs ${them.names.size}, ours ${us.size}`,
  );
  show("only theirs:", short);
  show("only ours:", extra);
  if (!same) differed++;

  await Bun.sleep(WAIT);
}

console.log(
  differed === 0
    ? "\nall green"
    : `\n${differed} of ${queries.length} queries differ`,
);
process.exit(differed === 0 ? 0 : 1);
