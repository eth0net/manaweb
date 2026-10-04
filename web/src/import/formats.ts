import { CONDITIONS } from "../collection/cards";

// Everything a row can say, named for the record rather than for whichever
// column a vendor happens to put it in. An import fills what it recognizes;
// an export writes every one the catalog or the record can answer.
export type Field =
  | "scryfallId"
  | "name"
  | "setCode"
  | "setName"
  | "collectorNumber"
  | "rarity"
  | "language"
  | "finish"
  | "quantity"
  | "condition"
  | "container"
  | "altered"
  | "misprint"
  | "tags"
  | "note"
  | "proxy"
  | "price"
  | "currency"
  | "marketValue"
  | "marketCurrency"
  | "createdAt";

// Which column feeds each field. A supported format is one of these written
// down and a custom one is the same thing built in the browser, so nothing but
// where it came from separates them. Read the other way it names the columns an
// export writes.
export type Binding = Partial<Record<Field, string>>;

// `header` is what an export writes, in the vendor's own order. A column no
// field binds goes out empty: `ManaBox ID` is theirs to issue.
export type Format = { name: string; binding: Binding; header?: string[] };

// A format built from a file's own headers states none, so it writes the
// columns it binds and nothing else.
export function columns(format: Format): string[] {
  return format.header ?? Object.values(format.binding).filter((one) => !!one);
}

// A row with no finish or count behind it is not a card.
const NEEDED: Field[] = ["finish", "quantity"];

// What a format has to find in a file to read a row at all. A printing is
// named by its id, or by the set and number the catalog turns into one.
export function needed(binding: Binding): Field[] {
  const naming: Field[] = binding.scryfallId
    ? ["scryfallId"]
    : ["setCode", "collectorNumber"];
  return [...naming, ...NEEDED];
}

// ManaBox's `Purchase price` is bound as what a copy was worth, which is the
// asymmetry `docs/scryfall.md` settles. Binding it to `price` instead is the
// opt-in for anyone who typed their own figures in.
export const MANABOX: Format = {
  name: "ManaBox",
  binding: {
    scryfallId: "Scryfall ID",
    name: "Name",
    setCode: "Set code",
    setName: "Set name",
    collectorNumber: "Collector number",
    rarity: "Rarity",
    language: "Language",
    finish: "Foil",
    quantity: "Quantity",
    condition: "Condition",
    altered: "Altered",
    misprint: "Misprint",
    marketValue: "Purchase price",
    marketCurrency: "Purchase price currency",
    createdAt: "Added",
  },
  header: [
    "Name",
    "Set code",
    "Set name",
    "Collector number",
    "Foil",
    "Rarity",
    "Quantity",
    "ManaBox ID",
    "Scryfall ID",
    "Purchase price",
    "Misprint",
    "Altered",
    "Condition",
    "Language",
    "Purchase price currency",
    "Added",
  ],
};

export const FORMATS = [MANABOX];

// Facts about a printing that the catalog already holds, so an export fills
// them and nothing reads them back. `Name` is the other one, and stays
// required because it is what tells one tracker's file from another's.
const FILLED: Field[] = ["setName", "rarity", "language", "proxy"];

// The format whose every bound column the file carries. Two formats can both
// fit, and the first wins, so a narrower one is listed before a broader.
export function detect(head: string[]): Format | null {
  const names = new Set(head.map(key));
  return (
    FORMATS.find((format) =>
      Object.entries(format.binding).every(
        ([field, column]) =>
          !column || FILLED.includes(field as Field) || names.has(key(column)),
      ),
    ) ?? null
  );
}

// A blank is how several exports write "not foil", and none writes it for a
// finish it doesn't know.
const FINISHES: Record<string, string> = {
  "": "nonfoil",
  normal: "nonfoil",
  nonfoil: "nonfoil",
  foil: "foil",
  etched: "etched",
};

export function finish(text: string): string | undefined {
  return FINISHES[key(text)];
}

const WRITTEN: Record<string, string> = {
  nonfoil: "normal",
  foil: "foil",
  etched: "etched",
};

// Nothing for a finish this vendor has no word for, which is the row a file
// would quietly drop on the way back in.
export function foil(one: string): string | undefined {
  return WRITTEN[one];
}

// Grades arrive spaced, cased or underscored, and the scale is the lexicon's.
// Vendors with a coarser one map onto it as they land, never before.
export function grade(text: string): string | undefined {
  return CONDITIONS.find((one) => key(one) === key(text));
}

// The grade written back, which is the lexicon's own scale in snake case.
export function graded(condition: string): string {
  return condition.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

export function flag(text: string): boolean {
  return ["true", "yes", "1"].includes(key(text));
}

export function flagged(set: boolean): string {
  return set ? "true" : "false";
}

// Column names and vocabularies are matched on what they say, not how they
// were typed.
export function key(text: string): string {
  return text.toLowerCase().replace(/[\s_-]/g, "");
}
