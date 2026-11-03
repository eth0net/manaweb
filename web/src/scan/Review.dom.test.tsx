import { expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import type { Card, Catalog, Print } from "../catalog";
import type { Holdings } from "../collection/cards";
import "../testing/dom";
import { writing } from "../testing/running";
import { Review } from "./Review";
import { type Entry, SCANNED, type Source } from "./scratch";
import type { Scratch } from "./store";

const PRINT = {
  id: "aaa",
  set: "10e",
  setName: "Tenth Edition",
  setKind: "core",
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
  prints: () => [PRINT, OTHER],
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
function show(
  entry: Entry,
  source: Source,
  also: Entry[] = [],
  at: Source["at"] = source.at,
) {
  let list = [entry, ...also];

  // Built fresh each time, so `again` draws what the moves have made of the
  // list rather than what it held when the screen first went up.
  const drawn = () => (
    <Review
      at={at}
      catalog={catalog}
      scratch={
        {
          ready: true,
          source,
          list,
          change: (move: (was: Entry[]) => Entry[]) => {
            list = move(list);
          },
          begin: () => {},
          clear: async () => {},
          problem: null,
        } satisfies Scratch
      }
      session={null}
      owning={owning}
      container={null}
      where={null}
    />
  );

  const view = render(drawn());
  return {
    view,
    kept: () => list[0] as Entry,
    all: () => list,
    again: () => view.rerender(drawn()),
  };
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

// The two reviews are two screens over one list, so each shows the list only
// where it belongs.
test("a review holds nothing the other flow read in", () => {
  const { view } = show(one({ line: 2 }), FILE, [], "scan");

  expect(view.queryByText("Remove Soul")).toBeNull();
  expect(view.getByText("Nothing scanned yet.")).toBeTruthy();
});

// A file row was never read off a photograph, so there is nothing to doubt.
test("a row off a file has nothing to be unsure of", () => {
  const { view } = show(one({ line: 2 }), FILE);

  expect(view.queryByText("unsure")).toBeNull();
  expect(view.getByRole("button", { name: /Remove Soul/ })).toBeTruthy();
});

// A file named the card, so the panel offers what that card was printed in
// rather than a search for another one.
test("the printing is picked from what the card was printed in", () => {
  const { view, kept } = show(one(), FILE);

  fireEvent.click(view.getByRole("button", { name: /Remove Soul/ }));
  fireEvent.change(view.getByLabelText("Printing"), {
    target: { value: OTHER.id },
  });
  expect(kept().scryfallId).toBe(PRINT.id);

  fireEvent.click(view.getByRole("button", { name: "Confirm" }));
  expect(kept().scryfallId).toBe(OTHER.id);
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
  expect(kept().dropped).toBe(true);
});

// The second press is the one that clears the screen, and only the screen:
// the row was already out of what a keep would write.
test("a struck row is cleared off by a second press", () => {
  const { view, all } = show(one({ dropped: true }), FILE);

  fireEvent.click(
    view.getByRole("button", { name: /Clear Remove Soul off the screen/ }),
  );
  expect(all()).toEqual([]);
});

// An import review has no second try, so the row stays where it was with
// everything it held.
test("a row struck off keeps its place and its stack", () => {
  const { view, kept, again } = show(one({ condition: "played" }), FILE);

  fireEvent.click(
    view.getByRole("button", { name: /Take this stack off the list/ }),
  );
  expect(kept().dropped).toBe(true);
  expect(kept().condition).toBe("played");

  again();
  fireEvent.click(view.getByRole("button", { name: /Put Remove Soul back/ }));
  expect(kept().dropped).toBe(false);
});

// The write the keep makes, held open: what the panel does while one is in
// flight is the whole of what it does wrong.
const running = writing();

// Signed in over a collection already read, which is the one state a keep is
// offered in.
const READY = {
  ready: true,
  stacks: [],
  owned: () => 0,
} as unknown as Holdings;

// A container decides nothing until something is written, so the choice is
// behind the press that writes rather than above the list.
test("where they go waits inside the press that files them", () => {
  const view = render(
    <Review
      at="file"
      catalog={catalog}
      scratch={
        {
          ready: true,
          source: FILE,
          list: [one()],
          change: () => {},
          begin: () => {},
          clear: async () => {},
          problem: null,
        } satisfies Scratch
      }
      session={{} as unknown as OAuthSession}
      owning={READY}
      container={null}
      where={<p>Somewhere to put them</p>}
    />,
  );

  expect(view.queryByText("Somewhere to put them")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Add to collection" }));
  expect(view.getByText("Somewhere to put them")).toBeTruthy();
  expect(view.getByRole("button", { name: "Keep 1 card" })).toBeTruthy();
  view.unmount();
});

function filing(list: Entry[] = [one()]) {
  return render(
    <Review
      at="file"
      catalog={catalog}
      scratch={
        {
          ready: true,
          source: FILE,
          list,
          change: () => {},
          begin: () => {},
          clear: async () => {},
          problem: null,
        } satisfies Scratch
      }
      session={{} as unknown as OAuthSession}
      owning={READY}
      container={null}
      where={null}
    />,
  );
}

// Nothing calls a write back once it is going, so a way out of the panel
// would be a lie: the cards land whatever the press said.
test("a keep already going offers no way out of itself", async () => {
  const view = filing();

  fireEvent.click(view.getByRole("button", { name: "Add to collection" }));
  fireEvent.click(view.getByRole("button", { name: "Keep 1 card" }));

  // The press on the page says the same, for a panel shut by Escape.
  const panel = () => within(view.getByRole("dialog"));
  await waitFor(() => panel().getByRole("button", { name: "Keeping…" }));
  const cancel = panel().getByRole("button", { name: "Cancel" });
  expect((cancel as HTMLButtonElement).disabled).toBe(true);

  running.finish("Your PDS refused it.");
  await waitFor(() =>
    view.getByText("Your PDS refused it. The list is still here."),
  );
  expect(view.queryByRole("dialog")).toBeNull();
  view.unmount();
});

// One job to a repository, so a keep made while an import of these same cards
// is going would take the place of one already half written.
test("an import under way leaves nothing to press", () => {
  running.state({ at: "running", done: 1, total: 2, due: 0, quiet: false });
  const view = filing();

  expect(view.queryByRole("button", { name: "Add to collection" })).toBeNull();
  expect(view.getByText(/An import holds the place/)).toBeTruthy();

  view.unmount();
  running.state({ at: "none" });
});

// A press that came and went with the list moved every row under it, so it
// stays and says there is nothing for it.
test("the press that joins repeats keeps its place", () => {
  const { view } = show(one(), FILE);

  const press = view.getByRole("button", { name: "Join duplicates" });
  expect((press as HTMLButtonElement).disabled).toBe(true);
});

test("two rows of one printing fold into one", () => {
  const { view, all } = show(one(), FILE, [one({ id: "b" })]);

  fireEvent.click(view.getByRole("button", { name: "Join duplicates" }));
  expect(all()).toHaveLength(1);
});

// A reload lands here before the store answers, and "nothing" said too early
// is the one thing this screen must not say.
test("an unread list is not an empty one", () => {
  const view = render(
    <Review
      at="file"
      catalog={catalog}
      scratch={
        {
          ready: false,
          source: FILE,
          list: [],
          change: () => {},
          begin: () => {},
          clear: async () => {},
          problem: null,
        } satisfies Scratch
      }
      session={null}
      owning={owning}
      container={null}
      where={null}
    />,
  );

  expect(view.queryByText("Nothing left of that file.")).toBeNull();
  expect(view.getByText("Looking for what was left here…")).toBeTruthy();
});
