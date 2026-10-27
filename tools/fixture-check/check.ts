// Holds the import fixtures to the catalog: the printing a row names has to
// exist, and the finish it claims has to be one that printing was made in.
//
//     bun run check
//
// Outside `just check`: it reads a built catalog, which CI has no way to make.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Catalog, type Print, printKey } from "../../web/src/catalog";
import { lined } from "../../web/src/import/csv";
import {
  detect,
  type Field,
  type Format,
  finish,
  key,
} from "../../web/src/import/formats";

process.chdir(dirname(dirname(import.meta.dir)));

const WHERE = process.env.MANAWEB_CATALOG ?? "catalog";
const FIXTURES = "web/src/import/fixtures";

// Every row of it is one a reader must refuse, so holding it to the catalog
// would be asking the wrong question.
const DELIBERATE = ["edges.csv"];

// What a row says about its printing, and where to say it if the catalog
// disagrees.
type Named = {
  line: number;
  // Whether the format names a printing by id, which decides what an empty
  // id cell means.
  bound: boolean;
  id: string;
  key: string;
  said: string;
  finish: string;
};

function held(): Catalog {
  const manifest = JSON.parse(
    readFileSync(join(WHERE, "manifest.json"), "utf8"),
  );
  const read = (name: string) => readFileSync(join(WHERE, name));
  return Catalog.read(read(manifest.cards.name), read(manifest.prints.name));
}

function named(text: string, format: Format): Named[] {
  const rows = lined(text);
  const head = rows.shift();
  if (!head) return [];

  const at = new Map(head.fields.map((name, index) => [key(name), index]));
  const column = (field: Field) => at.get(key(format.binding[field] ?? ""));
  const cell = (fields: string[], field: Field) =>
    (fields[column(field) ?? -1] ?? "").trim();

  const bound = Boolean(format.binding.scryfallId);

  // A blank line is a row the reader passes over, so counting it here would
  // overstate what was looked at.
  return rows
    .filter(({ fields }) => fields.some((one) => one.trim()))
    .map(({ fields, line }) => {
      const set = cell(fields, "setCode");
      const number = cell(fields, "collectorNumber");
      return {
        line,
        bound,
        id: cell(fields, "scryfallId").toLowerCase(),
        key: set && number ? printKey(set, number) : "",
        said: set && number ? `${set} ${number}` : "",
        finish: cell(fields, "finish"),
      };
    });
}

// Both ways of naming a printing are checked where a file carries both: a
// fixture whose two halves disagree is one the reader would resolve one way
// and a person would read the other.
function faults(catalog: Catalog, rows: Named[]): string[] {
  const byKey = catalog.locate(
    new Set(rows.map((row) => row.key).filter(Boolean)),
  );
  const ids = new Set(rows.map((row) => row.id).filter(Boolean));
  for (const id of byKey.values()) ids.add(id);
  const byId = catalog.resolve(ids);
  const found: string[] = [];

  for (const row of rows) {
    let print: Print | undefined;

    // The reader takes a bound id column as the whole of a row's naming, so a
    // row leaving it empty is one it refuses whatever else the row carries.
    if (row.bound ? !row.id : !row.id && !row.key) {
      found.push(`${row.line}: names no printing`);
      continue;
    }

    if (row.id) {
      print = byId.get(row.id)?.print;
      if (!print) found.push(`${row.line}: no such print ${row.id}`);
    }
    if (row.key) {
      const id = byKey.get(row.key);
      if (!id) found.push(`${row.line}: no such print ${row.said}`);
      else if (row.id && print && id !== row.id) {
        found.push(
          `${row.line}: ${row.id} is ${print.set} ${print.collectorNumber}, not ${row.said}`,
        );
      }
      print ??= id ? byId.get(id)?.print : undefined;
    }
    if (!print) continue;

    const how = finish(row.finish);
    if (!how) {
      found.push(`${row.line}: unknown finish ${row.finish}`);
    } else if (!print.finishes.includes(how)) {
      found.push(
        `${row.line}: ${print.set} ${print.collectorNumber} is ${print.finishes.join(" and ")} only, not ${how}`,
      );
    }
  }

  return found;
}

const catalog = held();
let wrong = 0;

for (const file of readdirSync(FIXTURES).sort()) {
  if (!file.endsWith(".csv") || DELIBERATE.includes(file)) continue;

  const text = readFileSync(join(FIXTURES, file), "utf8");
  const head = lined(text)[0];
  const format = head && detect(head.fields);
  if (!format) {
    console.log(`${file}: no format reads these columns`);
    wrong++;
    continue;
  }

  const rows = named(text, format);
  const found = faults(catalog, rows);
  for (const one of found) console.log(`${file}:${one}`);
  console.log(
    `${file}: ${rows.length} rows as ${format.name}, ${found.length} wrong`,
  );
  wrong += found.length;
}

if (wrong > 0) {
  console.log(`\n${wrong} rows the catalog does not bear out`);
  process.exit(1);
}
