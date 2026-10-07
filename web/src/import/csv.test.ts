import { expect, test } from "bun:test";
import { lined, parse } from "./csv";

test("a quoted field keeps its commas", () => {
  expect(parse('a,"Baba Lysaga, Night Witch",c')).toEqual([
    ["a", "Baba Lysaga, Night Witch", "c"],
  ]);
});

test("a doubled quote is one quote", () => {
  expect(parse('"Ach! Hans, ""Run!""",b')).toEqual([
    ['Ach! Hans, "Run!"', "b"],
  ]);
});

test("a quoted field keeps its line breaks", () => {
  expect(parse('"one\ntwo",b')).toEqual([["one\ntwo", "b"]]);
});

test("every line ending splits a row", () => {
  const rows = [
    ["a", "b"],
    ["c", "d"],
  ];
  expect(parse("a,b\nc,d")).toEqual(rows);
  expect(parse("a,b\r\nc,d")).toEqual(rows);
  expect(parse("a,b\rc,d")).toEqual(rows);
});

test("a trailing newline is not a row", () => {
  expect(parse("a,b\n")).toEqual([["a", "b"]]);
});

test("a byte order mark is not part of the first name", () => {
  expect(parse("﻿Name,Set code")).toEqual([["Name", "Set code"]]);
});

test("an empty field is a field", () => {
  expect(parse('a,,""')).toEqual([["a", "", ""]]);
});

test("a row is numbered by the line it starts on", () => {
  const at = (text: string) => lined(text).map((row) => row.line);

  expect(at('a,b\n"one\ntwo",c\nd,e')).toEqual([1, 2, 4]);
  expect(at('a,b\r\n"one\r\ntwo",c\r\nd,e')).toEqual([1, 2, 4]);
  expect(at('a,b\r"one\rtwo",c\rd,e')).toEqual([1, 2, 4]);
});
