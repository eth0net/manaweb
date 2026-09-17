import { CONDITIONS } from "../collection/cards";

// Everything an import can fill, named for the record rather than for whichever
// column a vendor happens to put it in.
export type Field =
  | "scryfallId"
  | "name"
  | "setCode"
  | "collectorNumber"
  | "finish"
  | "quantity"
  | "condition"
  | "container"
  | "altered"
  | "misprint"
  | "tags"
  | "note"
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

export type Format = { name: string; binding: Binding };

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
    collectorNumber: "Collector number",
    finish: "Foil",
    quantity: "Quantity",
    condition: "Condition",
    altered: "Altered",
    misprint: "Misprint",
    marketValue: "Purchase price",
    marketCurrency: "Purchase price currency",
    createdAt: "Added",
  },
};

export const FORMATS = [MANABOX];

// The format whose every bound column the file carries. Two formats can both
// fit, and the first wins, so a narrower one is listed before a broader.
export function detect(head: string[]): Format | null {
  const names = new Set(head.map(key));
  return (
    FORMATS.find((format) =>
      Object.values(format.binding).every(
        (column) => !column || names.has(key(column)),
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

// Grades arrive spaced, cased or underscored, and the scale is the lexicon's.
// Vendors with a coarser one map onto it as they land, never before.
export function grade(text: string): string | undefined {
  return CONDITIONS.find((one) => key(one) === key(text));
}

export function flag(text: string): boolean {
  return ["true", "yes", "1"].includes(key(text));
}

// Column names and vocabularies are matched on what they say, not how they
// were typed.
export function key(text: string): string {
  return text.toLowerCase().replace(/[\s_-]/g, "");
}
