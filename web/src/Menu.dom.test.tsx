import { expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { fireEvent, render } from "@testing-library/react";
import { Menu } from "./Menu";
import type { Session } from "./oauth/useSession";
import "./testing/dom";
import type { Status } from "./useCatalog";

// Neither reach anything: the picture and the repo read are asked for and
// never answered, which is the state a press lands in anyway.
const session = {
  did: "did:plc:abc",
  serverMetadata: { issuer: "https://pds.example" },
} as unknown as OAuthSession;

const status = {} as unknown as Status;

function signedIn(): Session {
  return {
    state: { status: "in", session },
    signIn: async () => {},
    signOut: () => {},
  } as unknown as Session;
}

function signedOut(): Session {
  return {
    state: { status: "out" },
    signIn: async () => {},
    signOut: () => {},
  } as unknown as Session;
}

// One press off the picture, rather than a control each in the header.
test("the account menu offers what used to sit beside it", () => {
  const view = render(
    <Menu account={signedIn()} status={status} loaded={null} />,
  );

  fireEvent.click(view.getByRole("button", { name: /did:plc:abc/ }));

  expect(view.getByRole("menuitem", { name: "Profile" })).toBeTruthy();
  expect(view.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
  expect(view.getByRole("menuitem", { name: "About" })).toBeTruthy();
  expect(view.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
});

// The first app preference, and what the surface exists to hold.
test("what a set counts is set from the menu", () => {
  const view = render(
    <Menu account={signedIn()} status={status} loaded={null} />,
  );

  fireEvent.click(view.getByRole("button", { name: /did:plc:abc/ }));
  fireEvent.click(view.getByRole("menuitem", { name: "Settings" }));

  expect(view.getByLabelText("Count treatments")).toBeTruthy();
});

// The entries lead somewhere, and choosing one puts the menu away.
test("what the app is opens from the menu", () => {
  const view = render(
    <Menu account={signedIn()} status={status} loaded={null} />,
  );

  fireEvent.click(view.getByRole("button", { name: /did:plc:abc/ }));
  fireEvent.click(view.getByRole("menuitem", { name: "About" }));

  expect(view.getByText("Build")).toBeTruthy();
  expect(view.queryByRole("menuitem", { name: "Profile" })).toBeNull();
});

// A press anywhere else, which is what the menu has instead of a backdrop.
test("a press away from the menu puts it back", () => {
  const view = render(
    <Menu account={signedIn()} status={status} loaded={null} />,
  );

  fireEvent.click(view.getByRole("button", { name: /did:plc:abc/ }));
  expect(view.getByRole("menuitem", { name: "Profile" })).toBeTruthy();

  fireEvent.pointerDown(document.body);

  expect(view.queryByRole("menuitem", { name: "Profile" })).toBeNull();
});

// There is no picture to hang a menu off, so the press is the form itself.
test("signed out the press is the sign-in form", () => {
  const view = render(
    <Menu account={signedOut()} status={status} loaded={null} />,
  );

  fireEvent.click(view.getByRole("button", { name: "Sign in" }));

  expect(view.getByLabelText(/Enter your handle/)).toBeTruthy();
});

// A menu button's own keys: the arrows move within it rather than tabbing
// through every entry to reach the last.
test("the arrows move through the entries and wrap", () => {
  const view = render(
    <Menu account={signedIn()} status={status} loaded={null} />,
  );
  fireEvent.click(view.getByRole("button", { name: /did:plc:abc/ }));

  const menu = view.getByRole("menu");
  expect(document.activeElement).toBe(
    view.getByRole("menuitem", { name: "Profile" }),
  );

  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    view.getByRole("menuitem", { name: "Settings" }),
  );

  fireEvent.keyDown(menu, { key: "ArrowUp" });
  fireEvent.keyDown(menu, { key: "ArrowUp" });
  expect(document.activeElement).toBe(
    view.getByRole("menuitem", { name: "Sign out" }),
  );

  fireEvent.keyDown(menu, { key: "Home" });
  expect(document.activeElement).toBe(
    view.getByRole("menuitem", { name: "Profile" }),
  );

  fireEvent.keyDown(menu, { key: "End" });
  expect(document.activeElement).toBe(
    view.getByRole("menuitem", { name: "Sign out" }),
  );
});

// Only one stop, so tabbing leaves the menu instead of walking it.
test("one entry at a time is in the tab order", () => {
  const view = render(
    <Menu account={signedIn()} status={status} loaded={null} />,
  );
  fireEvent.click(view.getByRole("button", { name: /did:plc:abc/ }));

  const stops = view
    .getAllByRole("menuitem")
    .filter((one) => one.getAttribute("tabindex") === "0");

  expect(stops).toHaveLength(1);
});

// Where the press came from, which a dialog does for itself.
test("escape puts the menu away and the focus back", () => {
  const view = render(
    <Menu account={signedIn()} status={status} loaded={null} />,
  );
  const press = view.getByRole("button", { name: /did:plc:abc/ });
  fireEvent.click(press);

  fireEvent.keyDown(document, { key: "Escape" });

  expect(view.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(press);
});
