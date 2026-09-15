import { expect, test } from "bun:test";
import { entry, HOME, known, remember, tab } from "./router";

test("a tab you are already in goes to the top of itself", () => {
  remember("/collection/at://did:plc:x/app.manaweb.container/abc");
  expect(entry("/collection", "/collection")).toBe("/collection");
});

test("a tab you are not in goes back where you left it", () => {
  remember("/cards/0000aaaa-0000-4000-8000-00000000000a");
  expect(entry("/cards", "/decks")).toBe(
    "/cards/0000aaaa-0000-4000-8000-00000000000a",
  );
});

test("what a search was narrowed to comes back with it", () => {
  remember("/cards?q=bolt&lang=ja");
  expect(entry("/cards", "/collection")).toBe("/cards?q=bolt&lang=ja");
});

test("pressing the tab you are in drops the search too", () => {
  remember("/cards?set=lea");
  expect(entry("/cards", "/cards")).toBe("/cards");
});

test("a tab never opened goes to the top of itself", () => {
  expect(entry("/lists", "/cards")).toBe("/lists");
});

test("leaving a tab at its top is what it returns to", () => {
  remember("/decks/one");
  remember("/decks");
  expect(entry("/decks", "/cards")).toBe("/decks");
});

// The callback lands on a path no tab owns, and is rewritten immediately.
test("a path outside the tabs is not somewhere to go back to", () => {
  remember("/oauth/callback");
  expect(entry(HOME, "/lists")).not.toBe("/oauth/callback");
  expect(known("/oauth/callback")).toBe(false);
  expect(tab("/oauth/callback")).toBe(HOME);
});
