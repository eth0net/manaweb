import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "./headers";

const FILE = `# a comment
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*
  Content-Security-Policy: default-src 'self'; img-src 'self' data: https://a.io
  X-Content-Type-Options: nosniff
`;

describe("reading a Pages headers file", () => {
  test("takes the rule asked for and no other", () => {
    expect(parse(FILE).map(([name]) => name)).toEqual([
      "Content-Security-Policy",
      "X-Content-Type-Options",
    ]);
    expect(parse(FILE, "/assets/*")).toEqual([
      ["Cache-Control", "public, max-age=31536000, immutable"],
    ]);
    expect(parse(FILE, "/nothing")).toEqual([]);
  });

  test("a value with its own colons stays whole", () => {
    expect(parse(FILE)[0]?.[1]).toBe(
      "default-src 'self'; img-src 'self' data: https://a.io",
    );
  });

  test("and the real file carries a policy", () => {
    const where = join(import.meta.dir, "..", "public", "_headers");
    const held = parse(readFileSync(where, "utf8"));
    expect(held.map(([name]) => name)).toContain("Content-Security-Policy");
    expect(held[0]?.[1]).toContain("https://cards.scryfall.io");
  });
});
