import { expect, test } from "bun:test";
import { callback } from "./client";

const URIS = [
  "https://manaweb.app/oauth/callback",
  "https://dev.manaweb.app/oauth/callback",
] as const;

test("each origin signs in against its own callback", () => {
  expect(callback(URIS, "https://dev.manaweb.app")).toBe(URIS[1]);
  expect(callback(URIS, "https://manaweb.app")).toBe(URIS[0]);
});

test("an origin the document does not list has no callback", () => {
  expect(callback(URIS, "https://manaweb.app.example")).toBeUndefined();
  expect(callback(URIS, "http://127.0.0.1:4173")).toBeUndefined();
});

test("the loopback client's one callback answers for it", () => {
  const only = ["http://127.0.0.1:4173/"] as const;
  expect(callback(only, "http://127.0.0.1:4173")).toBe(only[0]);
});
