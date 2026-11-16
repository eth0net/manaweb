import { expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { keep, recall, usePreference } from "./preferences";
import "./testing/dom";
import { database } from "./testing/idb";

database();

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

// The value survives the page, which is the half the shared copy does not do.
test("what was set is what is stored", async () => {
  await keep("treatments", true);
  expect(await recall("treatments")).toBe(true);

  await keep("treatments", false);
  expect(await recall("treatments")).toBe(false);
});
