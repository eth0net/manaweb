import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nonced, parse, reachable } from "./headers";

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

describe("letting the dev server's own scripts through", () => {
  test("the nonce joins script-src and nothing else", () => {
    const held = nonced(
      "default-src 'self'; script-src 'self'; img-src 'self' data:",
      "abc123",
    );
    expect(held).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc123'; img-src 'self' data:",
    );
  });

  test("and the real policy takes one", () => {
    const where = join(import.meta.dir, "..", "public", "_headers");
    const [, policy] = parse(readFileSync(where, "utf8"))[0] as [
      string,
      string,
    ];
    expect(nonced(policy, "abc123")).toContain(
      "script-src 'self' 'nonce-abc123'",
    );
    expect(policy).not.toContain("unsafe-inline'; script");
  });
});

describe("reaching the catalog in development", () => {
  test("the host asked for is the host named", () => {
    expect(reachable("connect-src 'self' https:", "192.168.1.4:5173")).toBe(
      "connect-src 'self' https: http://192.168.1.4:8080",
    );
    expect(reachable("connect-src 'self'; img-src 'self'", "[::1]:5173")).toBe(
      "connect-src 'self' http://[::1]:8080; img-src 'self'",
    );
  });

  test("and a request without one is left alone", () => {
    expect(reachable("connect-src 'self'", "")).toBe("connect-src 'self'");
  });

  test("the real policy names it once the nonce is in", () => {
    const where = join(import.meta.dir, "..", "public", "_headers");
    const [, policy] = parse(readFileSync(where, "utf8"))[0] as [
      string,
      string,
    ];
    const held = reachable(nonced(policy, "abc123"), "127.0.0.1:5173");
    expect(held).toContain("connect-src 'self' https: http://127.0.0.1:8080;");
    expect(held).toContain("script-src 'self' 'nonce-abc123'");
  });
});
