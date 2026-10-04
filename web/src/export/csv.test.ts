import { expect, test } from "bun:test";
import { parse } from "../import/csv";
import { write } from "./csv";

test("a field carrying a comma is quoted", () => {
  expect(write([["Baba Lysaga, Night Witch", "b"]])).toBe(
    '"Baba Lysaga, Night Witch",b\n',
  );
});

test("a quote is doubled and the field quoted", () => {
  expect(write([['Ach! Hans, "Run!"']])).toBe('"Ach! Hans, ""Run!"""\n');
});

test("a line break keeps its field together", () => {
  expect(write([["one\ntwo", "b"]])).toBe('"one\ntwo",b\n');
});

test("nothing else is quoted", () => {
  expect(write([["a", "", "c"]])).toBe("a,,c\n");
});

test("what is written is what reads back", () => {
  const rows = [
    ["Name", "Note"],
    ["Baba Lysaga, Night Witch", 'Ach! Hans, "Run!"'],
    ["Ordinary", "one\ntwo"],
  ];
  expect(parse(write(rows))).toEqual(rows);
});
