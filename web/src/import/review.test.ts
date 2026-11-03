// The trip a file's rows make before anything is written: read, reviewed as a
// list, and read back out as records.

import { expect, test } from "bun:test";
import { cards } from "../scan/scratch";
import { MANAWEB } from "./formats";
import { read } from "./read";
import { taken } from "./review";

const NOW = "2026-11-03T00:00:00.000Z";

const file = await Bun.file(
  new URL("./fixtures/edges.csv", import.meta.url),
).text();

const { rows } = read(file, MANAWEB, NOW);

test("a file carries more than a scan, and the list drops none of it", () => {
  expect(cards(taken(rows), null)).toEqual(rows.map(({ one }) => one));
});

test("every row keeps the line it came off", () => {
  expect(taken(rows).map((one) => one.line)).toEqual(
    rows.map(({ line }) => line),
  );
});

// The list keys off it, so two rows sharing one would be one row on screen.
test("no two rows share an id", () => {
  const list = taken(rows);
  expect(new Set(list.map((one) => one.id)).size).toBe(list.length);
});

test("a file row has nothing a scan would be asked about", () => {
  const one = taken(rows)[0];
  expect(one?.matched).toBeUndefined();
  expect(one?.margin).toBeUndefined();
  expect(one?.detected).toBeUndefined();
});

// The picker is the only thing that files a reviewed row, so it wins.
test("a container chosen in the review beats whatever the file said", () => {
  const where = "at://did:plc:x/app.manaweb.container/box";
  const filed = cards(taken(rows), where);
  expect(filed.every((one) => one.container === where)).toBe(true);
});
