import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keep, stamped } from "./capture";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

function posted(png: string, note: unknown = { of: "a card" }): Buffer {
  return Buffer.from(JSON.stringify({ note, png }));
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "manaweb-captures-"));
}

describe("what a capture is named", () => {
  test("sorts by when it was taken", () => {
    const at = new Date("2026-09-29T15:30:12.345Z");
    expect(stamped(at, 1)).toBe("20260929T153012Z-001");
  });

  test("separates two frames inside the same second", () => {
    const at = new Date("2026-09-29T15:30:12.345Z");
    expect(stamped(at, 2)).not.toBe(stamped(at, 1));
  });
});

describe("what reaches the disk", () => {
  test("writes the frame and the note under one stem", () => {
    const dir = scratch();
    keep(dir, posted(PNG.toString("base64")), "one");
    expect(readFileSync(join(dir, "one.png"))).toEqual(PNG);
    expect(JSON.parse(readFileSync(join(dir, "one.json"), "utf8"))).toEqual({
      of: "a card",
    });
  });

  test("makes the directory it was pointed at", () => {
    const dir = join(scratch(), "not", "there", "yet");
    keep(dir, posted(PNG.toString("base64")), "one");
    expect(readFileSync(join(dir, "one.png"))).toEqual(PNG);
  });

  test("refuses a body that is not a capture", () => {
    const dir = scratch();
    expect(() => keep(dir, Buffer.from("[]"), "one")).toThrow();
    expect(() => keep(dir, Buffer.from("null"), "one")).toThrow();
    expect(() => keep(dir, posted(""), "one")).toThrow();
  });

  test("refuses bytes that are not a PNG", () => {
    const dir = scratch();
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64");
    expect(() => keep(dir, posted(zip), "one")).toThrow();
    expect(() => readFileSync(join(dir, "one.png"))).toThrow();
  });
});
