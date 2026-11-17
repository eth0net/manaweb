import { expect, test } from "bun:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { Catalog } from "../catalog";
import { MANIFEST, scanning } from "../testing/scanning";
import { Scan } from "./Scan";
import { type Entry, SCANNED } from "./scratch";
import { type Grading, recallSwitch, type Scratch, SOLID } from "./store";

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

// A file read in is the import's own list now, so the camera carries on over
// one and counts nothing but what it scanned.
test("the camera counts what it scanned", () => {
  const held = still({ list: [HELD] });
  expect(held.getByRole("link", { name: /2 cards scanned/ })).toBeTruthy();
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

// It sat on the idle screen, so changing it meant closing the camera over the
// pile being scanned.
test("the grade is reachable with the camera open", async () => {
  const { view } = await shutter({});

  fireEvent.click(view.getByRole("button", { name: "Settings" }));

  expect(view.getByLabelText("Condition")).toBeTruthy();
});

// A preference rather than page state, so it outlives the read it was set
// over and the reload after that.
test("a solid reading is remembered", async () => {
  const first = still({});
  fireEvent.click(first.getByRole("button", { name: "Settings" }));
  fireEvent.click(first.getByLabelText("Solid"));
  await waitFor(async () => {
    expect(await recallSwitch(SOLID)).toBe(true);
  });
  first.unmount();

  const second = still({});
  fireEvent.click(second.getByRole("button", { name: "Settings" }));
  await waitFor(() => {
    const box = second.getByLabelText("Solid");
    expect((box as HTMLInputElement).checked).toBe(true);
  });
});
