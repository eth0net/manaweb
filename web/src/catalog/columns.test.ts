import { describe, expect, test } from "bun:test";
import { PrintColumns } from "./columns";

const tables = {
  version: "v",
  fields: [],
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
  });
  test("and today's tables fit", () => {
    expect(() => new PrintColumns(0, with_("layouts", 25))).not.toThrow();
  });
});
