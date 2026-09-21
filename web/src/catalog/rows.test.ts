import { describe, expect, test } from "bun:test";
import { chunks, count, split } from "./rows";

const FILE =
  '{"version":"v1","langs":["en"],"prints":[[1,"a"],[2,"b"],[3,"c"]]}';

describe("splitting a file from its rows", () => {
  test("the header comes back as an object of its own", () => {
    const { header, rows } = split(FILE, "prints");
    expect(JSON.parse(header)).toEqual({ version: "v1", langs: ["en"] });
    expect(rows).toBe('[1,"a"],[2,"b"],[3,"c"]');
  });

  test("and a file without that array says so", () => {
    expect(() => split(FILE, "cards")).toThrow("no cards array");
    expect(() => split(String.raw`{"a":1,"prints":[[1]]`, "prints")).toThrow(
      "does not end ]}",
    );
  });
});

describe("reading rows in batches", () => {
  const rows = (text: string, each: number) => [...chunks(text, each)];

  test("every batch but the last holds the size asked for", () => {
    const { rows: text } = split(FILE, "prints");
    expect(rows(text, 2)).toEqual([
      [
        [1, "a"],
        [2, "b"],
      ],
      [[3, "c"]],
    ]);
    expect(rows(text, 3)).toEqual([
      [
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ],
    ]);
    expect(rows(text, 99)).toEqual([
      [
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ],
    ]);
    expect(count(text)).toBe(3);
  });

  test("a bracket inside a value closes nothing", () => {
    const text = '["a]b",1],["c[d",2],["e\\"]",3]';
    expect(count(text)).toBe(3);
    expect(rows(text, 1).flat()).toEqual([
      ["a]b", 1],
      ["c[d", 2],
      ['e"]', 3],
    ]);
  });

  test("nested arrays belong to their row", () => {
    const text = '[[1,2],["x"]],[[3],[]]';
    expect(count(text)).toBe(2);
    expect(rows(text, 5)).toEqual([
      [
        [[1, 2], ["x"]],
        [[3], []],
      ],
    ]);
  });

  test("no rows at all", () => {
    expect(count("")).toBe(0);
    expect(rows("", 10)).toEqual([]);
  });
});
