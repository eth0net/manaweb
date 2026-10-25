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
  remember("/cards?q=bolt");
  expect(entry("/cards", "/cards?q=bolt")).toBe("/cards");
});

// A set is a setting on the list rather than a page under it, so the press
// that leaves it is not also the press that leaves browsing.
test("leaving a set goes to the sets, not past them to the cards", () => {
  expect(entry("/cards", "/cards/sets?set=lea")).toBe("/cards/sets");
});

test("a second press is what gets out of the sets", () => {
  expect(entry("/cards", "/cards/sets")).toBe("/cards");
});

test("what a set was filtered to goes with the set", () => {
  expect(entry("/cards", "/cards/sets?set=lea&colors=W")).toBe("/cards/sets");
});

// The container's address holds slashes of its own, so there is no segment
// above it to climb to.
test("a drill-down the tab owns goes straight back to the tab", () => {
  const held = "/collection/at://did:plc:x/app.manaweb.container/abc";
  expect(entry("/collection", held)).toBe("/collection");
});

test("a tab never opened goes to the top of itself", () => {
  expect(entry("/lists", "/cards")).toBe("/lists");
});

test("leaving a tab at its top is what it returns to", () => {
  remember("/decks/one");
  remember("/decks");
  expect(entry("/decks", "/cards")).toBe("/decks");
});

// Signing in lands here with `code` and `state` in the query and the bar is
// drawn before the rewrite, so a press must not take the path without them.
test("a path no tab owns is never where a tab's own button goes", () => {
  remember("/cards?q=bolt");
  const back = "/oauth/callback?code=a&state=b";

  expect(entry("/cards", back)).toBe("/cards?q=bolt");
  expect(entry("/cards", "/?code=a&state=b")).toBe("/cards?q=bolt");
});

// The callback lands on a path no tab owns, and is rewritten immediately.
test("a path outside the tabs is not somewhere to go back to", () => {
  remember("/oauth/callback");
  expect(entry(HOME, "/lists")).not.toBe("/oauth/callback");
  expect(known("/oauth/callback")).toBe(false);
  expect(tab("/oauth/callback")).toBe(HOME);
});
