import { describe, expect, test } from "bun:test";
import { Runs, Uuids } from "./strings";

describe("a column of strings in one run", () => {
  test("comes back in the order it went in", () => {
    const held = new Runs(4, 2);
    for (const one of ["", "a", "329★", "ハルマゲドン"]) held.push(one);
    held.close();
    expect([0, 1, 2, 3].map((at) => held.get(at))).toEqual([
      "",
      "a",
      "329★",
      "ハルマゲドン",
    ]);
  });

  test("and empty is not absent", () => {
    const held = new Runs(2);
    held.push("");
    held.push(null);
    held.close();
    expect(held.get(0)).toBe("");
    expect(held.get(1)).toBeNull();
  });
});

describe("a column of uuids", () => {
  const one = "0000579f-7b35-4ed3-b44c-db2a538066fe";

  test("comes back as it went in", () => {
    const held = new Uuids(2);
    held.push(one);
    held.push(one.toUpperCase());
    expect(held.get(0)).toBe(one);
    expect(held.get(1)).toBe(one.toUpperCase());
  });

  test("and anything else is refused rather than truncated", () => {
    expect(() => new Uuids(1).push(one.slice(1))).toThrow("36 characters");
    expect(() => new Uuids(1).push(`${one.slice(1)}★`)).toThrow("not a uuid");
  });
});
