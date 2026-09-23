import { describe, expect, test } from "bun:test";
import type { Manifest } from ".";
import { parts } from ".";
import { same } from "./load";

function manifest(extra: Record<string, unknown> = {}): Manifest {
  return {
    version: "2026-09-22T09:05:44.323+00:00",
    cards: { name: "cards.aaaa.json", rows: 2, bytes: 10 },
    prints: { name: "prints.bbbb.json", rows: 3, bytes: 20 },
    ...extra,
  } as Manifest;
}

describe("what a manifest names", () => {
  test("is every entry in it, not the two the client knows", () => {
    const named = parts(
      manifest({ artwork: { name: "a.cc.bin", rows: 1, bytes: 4 } }),
    );
    expect(named.map((part) => part.name)).toEqual([
      "cards.aaaa.json",
      "prints.bbbb.json",
      "a.cc.bin",
    ]);
  });

  // The export gains parts; a client that predates one still has to keep it
  // rather than sweep it away on the next load.
  test("includes a part this client has no name for", () => {
    const named = parts(
      manifest({ text: { name: "text.dd.json", rows: 1, bytes: 4 } }),
    );
    expect(named.map((part) => part.name)).toContain("text.dd.json");
  });

  test("is not the version, which is a string", () => {
    expect(parts(manifest()).length).toBe(2);
  });

  // A manifest gains fields that are not files. One carrying a name would
  // otherwise be fetched, and would report an update every time it moved.
  test("is not something that merely carries a name", () => {
    const named = parts(manifest({ source: { name: "default-cards" } }));
    expect(named.map((part) => part.name)).not.toContain("default-cards");
  });
});

describe("two manifests are the same catalog", () => {
  test("when every file they name is", () => {
    expect(same(manifest(), manifest({ version: "later" }))).toBe(true);
  });

  test("and not when a part was rebuilt beside an unchanged pair", () => {
    const held = manifest({
      artwork: { name: "a.cc.bin", rows: 1, bytes: 4 },
    });
    const fresh = manifest({
      artwork: { name: "a.dd.bin", rows: 1, bytes: 4 },
    });
    expect(same(held, fresh)).toBe(false);
  });

  test("and not when a part arrives that was not there before", () => {
    const fresh = manifest({
      artwork: { name: "a.cc.bin", rows: 1, bytes: 4 },
    });
    expect(same(manifest(), fresh)).toBe(false);
  });
});
