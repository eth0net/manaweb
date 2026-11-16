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

  expect(view.getByRole("button", { name: "Profile" })).toBeTruthy();
  expect(view.getByRole("button", { name: "About" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Sign out" })).toBeTruthy();
});

// The entries lead somewhere, and choosing one puts the menu away.
test("what the app is opens from the menu", () => {
  const view = render(
    <Menu account={signedIn()} status={status} loaded={null} />,
  );

  fireEvent.click(view.getByRole("button", { name: /did:plc:abc/ }));
  fireEvent.click(view.getByRole("button", { name: "About" }));

  expect(view.getByText("Build")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Profile" })).toBeNull();
});

// A press anywhere else, which is what the menu has instead of a backdrop.
test("a press away from the menu puts it back", () => {
  const view = render(
    <Menu account={signedIn()} status={status} loaded={null} />,
  );

  fireEvent.click(view.getByRole("button", { name: /did:plc:abc/ }));
  expect(view.getByRole("button", { name: "Profile" })).toBeTruthy();

  fireEvent.pointerDown(document.body);

  expect(view.queryByRole("button", { name: "Profile" })).toBeNull();
});

// There is no picture to hang a menu off, so the press is the form itself.
test("signed out the press is the sign-in form", () => {
  const view = render(
    <Menu account={signedOut()} status={status} loaded={null} />,
  );

  fireEvent.click(view.getByRole("button", { name: "Sign in" }));

  expect(view.getByLabelText(/Enter your handle/)).toBeTruthy();
});
