import { expect, test } from "bun:test";
import { SCOPES } from "../config";

test("the requested scopes are the ones the document declares", async () => {
  const document = await Bun.file(
    new URL("../../public/oauth/client-metadata.json", import.meta.url),
  ).json();

  expect(document.scope.split(/\s+/).toSorted()).toEqual(SCOPES.toSorted());
});

// Dropping it from both sides at once leaves the test above green and every
// loopback sign-in throwing: the id is parsed against this one by name.
test("the loopback client's required scope is among them", () => {
  expect(SCOPES).toContain("atproto");
});
