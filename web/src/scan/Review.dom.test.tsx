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
  setName: "Tenth Edition",
  collectorNumber: "100",
  rarity: "common",
  finishes: ["nonfoil", "foil"],
  flags: [],
  lang: "en",
  imageStatus: "highres_scan",
} as unknown as Print;

// The same card in another set, which is what an unsure reading offers.
const OTHER = {
  ...PRINT,
  id: "bbb",
  set: "7ed",
  setName: "Seventh Edition",
  collectorNumber: "80",
  finishes: ["nonfoil"],
} as unknown as Print;

const CARD = { name: "Remove Soul", index: 0 } as unknown as Card;

// Only what the screen reads, so a change to the rest does not reach here.
const catalog = {
  resolve: () =>
    new Map([
      [PRINT.id, { card: CARD, print: PRINT }],
      [OTHER.id, { card: CARD, print: OTHER }],
    ]),
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
  expect(view.getByText("unsure")).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: /Remove Soul/ }));
  expect(view.getByText(/Nearest, but not by much/)).toBeTruthy();
});

// A file row was never read off a photograph, so there is nothing to doubt.
test("a row off a file has nothing to be unsure of", () => {
  const { view } = show(one({ line: 2 }), FILE);

  expect(view.queryByText("unsure")).toBeNull();
  expect(view.getByRole("button", { name: /Remove Soul/ })).toBeTruthy();
});

// The printing is edited where the rest of the stack is, so it waits on the
// same press.
test("another printing lands on confirm and not before", () => {
  const picked = one({
    matched: [{ distance: 0, prints: [PRINT.id, OTHER.id] }],
  });
  const { view, kept } = show(picked, SCANNED);

  fireEvent.click(view.getByRole("button", { name: /Remove Soul/ }));
  fireEvent.click(view.getByRole("button", { name: /Seventh Edition/ }));
  expect(kept().scryfallId).toBe(PRINT.id);

  fireEvent.click(view.getByRole("button", { name: "Confirm" }));
  expect(kept().scryfallId).toBe(OTHER.id);
  expect(kept().picked).toBe(true);
});

// The finish on the panel is the one the printing under it was made in, not
// the one the stack arrived with.
test("picking a printing made one way says so", () => {
  const picked = one({
    finish: "foil",
    matched: [{ distance: 0, prints: [PRINT.id, OTHER.id] }],
  });
  const { view } = show(picked, SCANNED);

  fireEvent.click(view.getByRole("button", { name: /Remove Soul/ }));
  fireEvent.click(view.getByRole("button", { name: /Seventh Edition/ }));

  expect(view.getByText("Only made in nonfoil.")).toBeTruthy();
});

test("cancelling the edit leaves the stack as it was", () => {
  const { view, kept } = show(one(), FILE);

  fireEvent.click(view.getByRole("button", { name: /Remove Soul/ }));
  fireEvent.change(view.getByLabelText("Condition"), {
    target: { value: "played" },
  });
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));

  expect(kept().condition).toBe("nearMint");
});

test("confirming the edit is what moves the stack", () => {
  const { view, kept } = show(one(), FILE);

  fireEvent.click(view.getByRole("button", { name: /Remove Soul/ }));
  fireEvent.change(view.getByLabelText("Condition"), {
    target: { value: "played" },
  });
  fireEvent.click(view.getByRole("button", { name: "Confirm" }));

  expect(kept().condition).toBe("played");
});

// The count is edited where the rest of the stack is, so it waits on the
// same press.
test("the count is settled by the panel, not on the way through it", () => {
  const { view, kept } = show(one(), FILE);

  fireEvent.click(view.getByRole("button", { name: /Remove Soul/ }));
  fireEvent.click(view.getByRole("button", { name: "One more" }));
  expect(kept().quantity).toBe(1);

  fireEvent.click(view.getByRole("button", { name: "Confirm" }));
  expect(kept().quantity).toBe(2);
});

// Taking a row off the list is its own press, where it was once a choice
// inside the panel that edits one.
test("a row goes without opening anything", () => {
  const { view, kept } = show(one(), FILE);

  fireEvent.click(
    view.getByRole("button", { name: /Take this stack off the list/ }),
  );
  expect(view.queryByRole("dialog")).toBeNull();
  expect(kept()).toBeUndefined();
});
