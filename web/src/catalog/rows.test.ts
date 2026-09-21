import { describe, expect, test } from "bun:test";
import { chunks, count, split } from "./rows";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (of: Uint8Array) => new TextDecoder().decode(of);

const FILE = bytes(
  '{"version":"v1","langs":["en"],"prints":[[1,"a"],[2,"b"],[3,"c"]]}',
);

describe("splitting a file from its rows", () => {
  test("the header comes back as an object of its own", () => {
    const { header, rows } = split(FILE, "prints");
    expect(JSON.parse(header)).toEqual({ version: "v1", langs: ["en"] });
    expect(text(rows)).toBe('[1,"a"],[2,"b"],[3,"c"]');
  });

  test("and a file without that array says so", () => {
    expect(() => split(FILE, "cards")).toThrow("no cards array");
    expect(() =>
      split(bytes(String.raw`{"a":1,"prints":[[1]]`), "prints"),
    ).toThrow("does not end ]}");
  });
});

describe("reading rows in batches", () => {
  const rows = (of: string, each: number) => [...chunks(bytes(of), each)];

  test("every batch but the last holds the size asked for", () => {
    const held = text(split(FILE, "prints").rows);
    expect(rows(held, 2)).toEqual([
      [
        [1, "a"],
        [2, "b"],
      ],
      [[3, "c"]],
    ]);
    expect(rows(held, 3)).toEqual([
      [
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ],
    ]);
    expect(rows(held, 99)).toEqual([
      [
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ],
    ]);
    expect(count(bytes(held))).toBe(3);
  });

  test("a bracket inside a value closes nothing", () => {
    const held = '["a]b",1],["c[d",2],["e\\"]",3]';
    expect(count(bytes(held))).toBe(3);
    expect(rows(held, 1).flat()).toEqual([
      ["a]b", 1],
      ["c[d", 2],
      ['e"]', 3],
    ]);
  });

  test("nested arrays belong to their row", () => {
    const held = '[[1,2],["x"]],[[3],[]]';
    expect(count(bytes(held))).toBe(2);
    expect(rows(held, 5)).toEqual([
      [
        [[1, 2], ["x"]],
        [[3], []],
      ],
    ]);
  });

  test("a multi-byte character closes nothing either", () => {
    const held = '["329★",1],["日本語",2]';
    expect(count(bytes(held))).toBe(2);
    expect(rows(held, 5).flat()).toEqual([
      ["329★", 1],
      ["日本語", 2],
    ]);
  });

  test("no rows at all", () => {
    expect(count(bytes(""))).toBe(0);
    expect(rows("", 10)).toEqual([]);
  });
});
