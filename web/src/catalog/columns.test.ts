import { describe, expect, test } from "bun:test";
import {
  CARD_FIELDS,
  CardColumns,
  COLORS,
  PRINT_FIELDS,
  PrintColumns,
} from "./columns";

const tables = {
  version: "v",
  fields: PRINT_FIELDS,
  finishes: ["a"],
  flags: ["a"],
  rarities: ["a"],
  layouts: ["a"],
  imageStatuses: ["a"],
  langs: ["en"],
  artists: ["a"],
  sets: [],
} as never;

const with_ = (key: string, many: number) =>
  ({
    ...(tables as object),
    [key]: Array.from({ length: many }, (_, i) => String(i)),
  }) as never;

describe("a column too narrow for its table", () => {
  test("is refused rather than wrapped", () => {
    expect(() => new PrintColumns(0, with_("finishes", 9))).toThrow(
      "exceed 8",
    );
    expect(() => new PrintColumns(0, with_("flags", 9))).toThrow("exceed 8");
    expect(() => new PrintColumns(0, with_("layouts", 300))).toThrow(
      "exceed 255",
    );
    expect(() => new PrintColumns(0, with_("artists", 70000))).toThrow(
      "exceed 65534",
    );
    expect(() => new PrintColumns(0, with_("langs", 32))).toThrow("exceed 31");
  });
  test("and today's tables fit", () => {
    expect(() => new PrintColumns(0, with_("layouts", 25))).not.toThrow();
  });

  test("the cards file has two of its own", () => {
    const cards = {
      version: "v",
      fields: CARD_FIELDS,
      kinds: [],
      colors: [...COLORS],
      flags: [],
    };
    const many = (held: number) => Array.from({ length: held }, String);
    expect(() => new CardColumns(0, { ...cards, kinds: many(300) })).toThrow(
      "exceed 255",
    );
    expect(() => new CardColumns(0, { ...cards, flags: many(9) })).toThrow(
      "exceed 8",
    );
    expect(() => new CardColumns(0, cards)).not.toThrow();
  });
});

describe("a cards file from before the color bitmask", () => {
  test("is refused rather than read as colorless", () => {
    const old = {
      version: "v",
      fields: CARD_FIELDS,
      kinds: [],
      flags: [],
    } as never;
    expect(() => new CardColumns(0, old)).toThrow(
      "predates the color bitmask",
    );
  });
});

describe("a file whose columns are not the ones this client reads", () => {
  test("is refused rather than read at the wrong index", () => {
    expect(
      () =>
        new PrintColumns(0, {
          ...(tables as object),
          fields: ["id"],
        } as never),
    ).toThrow("prints holds id");
  });
});
