import { afterEach, expect, test } from "bun:test";
import { database } from "../testing/idb";
import { frame, hold } from "./frames";

afterEach(() => void database());
database();

const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]);

test("a frame comes back by the stack it belongs to", async () => {
  await hold("a", png());
  expect(await frame("a")).not.toBeNull();
  expect(await frame("b")).toBeNull();
});

// Bounded, because these are megabytes each and a scanning run is long.
test("only the last few are kept", async () => {
  for (const id of ["a", "b", "c", "d", "e", "f", "g"]) await hold(id, png());

  expect(await frame("a")).toBeNull();
  expect(await frame("b")).toBeNull();
  expect(await frame("c")).not.toBeNull();
  expect(await frame("g")).not.toBeNull();
});

test("a frame missing is not an error, it is nothing to report", async () => {
  expect(await frame("never")).toBeNull();
});
