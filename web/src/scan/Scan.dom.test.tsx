import { expect, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import type { Catalog } from "../catalog";
import { MANIFEST, scanning } from "../testing/scanning";
import { Scan } from "./Scan";
import { type Entry, SCANNED, type Source } from "./scratch";
import type { Grading, Scratch } from "./store";

scanning();

// Nothing here reaches the catalog: every press under test is refused before
// a frame is read.
const catalog = {} as unknown as Catalog;

const grading = { grade: "nearMint", regrade: () => {} } satisfies Grading;

const scratch = {
  ready: true,
  source: SCANNED,
  list: [],
  change: () => {},
  begin: () => {},
  clear: async () => {},
  problem: null,
} satisfies Scratch;

const HELD = { id: "a", quantity: 2 } as Entry;

const FILE: Source = {
  at: "file",
  format: "ManaBox",
  file: "collection.csv",
  digest: "sha256-cafe",
};

function still(over: Partial<Scratch>) {
  return render(
    <Scan
      catalog={catalog}
      manifest={MANIFEST}
      scratch={{ ...scratch, ...over }}
      grading={grading}
    />,
  );
}

// The shutter is only up once a camera is running behind it, so every test
// that presses it opens one first.
async function shutter(over: Partial<Scratch>) {
  const view = still(over);

  fireEvent.click(view.getByRole("button", { name: /Open the camera/ }));
  return { view, press: await view.findByRole("button", { name: /^Scan$/ }) };
}

// The guard reads a source that arrives with the stored list, so until that
// read answers it cannot tell an empty device from a file under review.
test("the shutter waits for the list already held", async () => {
  const { view, press } = await shutter({ ready: false });
  fireEvent.click(press);

  expect(
    await view.findByText(/Still looking for a list already open/),
  ).toBeTruthy();
});

test("a file open for review takes the shutter out of use", async () => {
  const { view, press } = await shutter({ source: FILE });
  fireEvent.click(press);

  expect(await view.findByText(/A file is open for review/)).toBeTruthy();
});

// A file read in is the import's list and is reviewed under the import, so
// the viewfinder neither counts it nor offers a way into it.
test("a file read in is not the scan's own list", () => {
  const held = still({ list: [HELD] });
  expect(held.getByRole("link", { name: /2 cards scanned/ })).toBeTruthy();
  held.unmount();

  const file = still({ source: FILE, list: [HELD] });
  expect(file.queryByRole("link", { name: /cards/ })).toBeNull();
});

// Without this the two above pass just as well on a camera that never works.
test("a settled list of its own is scanned into", async () => {
  const { press } = await shutter({});
  fireEvent.click(press);

  expect(press.textContent).toContain("Reading");
  // The read this started runs on past the assertion, and it is this test
  // that has to see the end of it.
  await act(async () => {});
});
