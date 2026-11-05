import { expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import type { Card, Catalog, Print } from "../catalog";
import type { Holdings } from "../collection/cards";
import "../testing/dom";
import { Review } from "./Review";
import { type Entry, SCANNED, type Source } from "./scratch";
import type { Scratch } from "./store";

const PRINT = {
  id: "aaa",
  set: "10e",
  collectorNumber: "100",
  rarity: "common",
  finishes: ["nonfoil", "foil"],
  flags: [],
  lang: "en",
  imageStatus: "highres_scan",
} as unknown as Print;

const CARD = { name: "Remove Soul", index: 0 } as unknown as Card;

// Only what the screen reads, so a change to the rest does not reach here.
const catalog = {
  resolve: () => new Map([[PRINT.id, { card: CARD, print: PRINT }]]),
  find: () => [],
  prints: () => [],
} as unknown as Catalog;

// Unread, which is the one state that needs no plan arithmetic behind it.
const owning = {
  ready: false,
  stacks: [],
  owned: () => 0,
} as unknown as Holdings;

const FILE: Source = {
  at: "file",
  format: "ManaBox",
  file: "collection.csv",
  digest: "sha256-cafe",
};

function one(over: Partial<Entry> = {}): Entry {
  return {
    id: "a",
    at: "2026-11-05T00:00:00.000Z",
    scryfallId: PRINT.id,
    finish: "nonfoil",
    condition: "nearMint",
    quantity: 1,
    ...over,
  };
}

// The list is read back rather than re-rendered: what a press is worth is the
// move it made, and nothing here holds state between renders.
function show(entry: Entry, source: Source) {
  let list = [entry];
  const scratch = {
    ready: true,
    source,
    list,
    change: (move: (was: Entry[]) => Entry[]) => {
      list = move(list);
    },
    begin: () => {},
    clear: async () => {},
    problem: null,
  } satisfies Scratch;

  const view = render(
    <Review
      catalog={catalog}
      scratch={scratch}
      session={null}
      owning={owning}
      container={null}
      tools={null}
    />,
  );
  return { view, kept: () => list[0] as Entry };
}

test("a row carries the card, the printing and the line it came off", () => {
  const { view } = show(one({ line: 2 }), FILE);

  expect(view.getByText("Remove Soul")).toBeTruthy();
  expect(view.getByText("10E #100 · C · Line 2")).toBeTruthy();
  expect(view.getByText("nonfoil")).toBeTruthy();
  expect(view.getByText("near mint")).toBeTruthy();
});

// The fold under every row was five lines of a three-line fact.
test("what the reading is unsure of stays out of the row", () => {
  const { view } = show(one(), SCANNED);

  expect(view.queryByText(/Nearest, but not by much/)).toBeNull();
  const ask = view.getByRole("button", { name: /This reading is unsure/ });

  fireEvent.click(ask);
  expect(view.getByText(/Nearest, but not by much/)).toBeTruthy();
});

// A file row was never read off a photograph, so there is nothing to doubt.
test("a row off a file asks rather than warns", () => {
  const { view } = show(one({ line: 2 }), FILE);

  expect(view.queryByRole("button", { name: /unsure/ })).toBeNull();
  expect(
    view.getByRole("button", { name: /A different printing/ }),
  ).toBeTruthy();
});

test("cancelling the edit leaves the stack as it was", () => {
  const { view, kept } = show(one(), FILE);

  fireEvent.click(view.getByRole("button", { name: /Change this stack/ }));
  fireEvent.change(view.getByLabelText("Condition"), {
    target: { value: "played" },
  });
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));

  expect(kept().condition).toBe("nearMint");
});

test("confirming the edit is what moves the stack", () => {
  const { view, kept } = show(one(), FILE);

  fireEvent.click(view.getByRole("button", { name: /Change this stack/ }));
  fireEvent.change(view.getByLabelText("Condition"), {
    target: { value: "played" },
  });
  fireEvent.click(view.getByRole("button", { name: "Confirm" }));

  expect(kept().condition).toBe("played");
});

// The count is the press somebody makes over and over, so it stays on the row
// where the panel holds everything else.
test("the count is still a press on the row itself", () => {
  const { view, kept } = show(one(), FILE);

  fireEvent.click(view.getByRole("button", { name: "One more" }));
  expect(kept().quantity).toBe(2);
});
