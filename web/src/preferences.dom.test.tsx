import { beforeEach, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { keep, recall, usePreference } from "./preferences";
import "./testing/dom";
import { database } from "./testing/idb";
import { preferences } from "./testing/preferences";

database();

beforeEach(() => {
  preferences();
});

// Two screens reading one preference, which is what the sets list and the
// settings panel are.
function Pair() {
  const here = usePreference("treatments");
  const there = usePreference("treatments");

  return (
    <>
      <button type="button" onClick={() => here.change(!here.held)}>
        Flip
      </button>
      <p>reading {there.held ? "treatments" : "printings"}</p>
    </>
  );
}

// It used to take a reload: each caller held its own copy, so the one that
// did not change it carried on showing what it was.
test("a preference changed on one screen reaches the other", async () => {
  const view = render(<Pair />);
  expect(view.getByText(/reading printings/)).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "Flip" }));

  await waitFor(() => {
    expect(view.getByText(/reading treatments/)).toBeTruthy();
  });
});

// A screen that opens on a preference already set, with no read to wait for.
test("a screen starts on what was already chosen", () => {
  preferences({ treatments: true });

  const view = render(<Pair />);

  expect(view.getByText(/reading treatments/)).toBeTruthy();
});

// A build that changed what a preference is leaves the old one behind, and
// what it meant is not recoverable from the value.
test("a stored preference of the wrong shape falls back", async () => {
  await keep("treatments", "yes");

  const view = render(<Pair />);
  // The hook's own read is already in flight against this store, and a
  // request made after it is answered after it. Asserting before that lands
  // would pass on the value nothing had read yet.
  await recall("treatments");
  await recall("treatments");

  expect(view.getByText(/reading printings/)).toBeTruthy();
});

// The value survives the page, which is the half the shared copy does not do.
test("what was set is what is stored", async () => {
  await keep("treatments", true);
  expect(await recall("treatments")).toBe(true);

  await keep("treatments", false);
  expect(await recall("treatments")).toBe(false);
});
