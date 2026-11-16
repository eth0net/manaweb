import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { keep, recall, usePreference } from "./preferences";
import "./testing/dom";
import { database } from "./testing/idb";

database();

// Its own file: the read happens once per key per process, so a test about
// what a first read does cannot follow one that has already had it.
function Reading() {
  const treatments = usePreference("treatments");
  return <p>reading {treatments.held ? "treatments" : "printings"}</p>;
}

// A build that changed what a preference is leaves the old one behind, and
// what it meant is not recoverable from the value.
test("a stored preference of the wrong shape falls back", async () => {
  await keep("treatments", "yes");

  const view = render(<Reading />);
  // The hook's own read is already in flight against this store, and a
  // request made after it is answered after it. Asserting before that lands
  // would pass on the value nothing had read yet.
  await recall("treatments");
  await recall("treatments");

  expect(view.getByText(/reading printings/)).toBeTruthy();
});
