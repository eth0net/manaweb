import { describe, expect, test } from "bun:test";
import { KEY } from "../terms";
import { counted, counting } from "./Count";

describe("how many colors", () => {
  test("is written with the key's own spelling, not every one it reads", () => {
    expect(counted("bolt", KEY.colors, "2", "4")).toBe("bolt c>=2 c<=4");
    expect(counted("bolt", KEY.identity, "3", "3")).toBe("bolt id=3");
  });

  test("reads back what it wrote, and what was typed", () => {
    expect(counting("c>=2 c<=4", KEY.colors)).toEqual({ low: "2", high: "4" });
    expect(counting("color=3", KEY.colors)).toEqual({ low: "3", high: "3" });
    expect(counting("bolt", KEY.colors)).toEqual({ low: "", high: "" });
  });

  test("leaves the pips where they are", () => {
    expect(counted("c:wu", KEY.colors, "2", "")).toBe("c:wu c>=2");
  });
});
