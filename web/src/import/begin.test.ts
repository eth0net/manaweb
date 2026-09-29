import { afterEach, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import type { Owned } from "../collection/cards";
import { database } from "../testing/idb";
import type { Receipt } from "./receipt";
import { attach, begin, halt } from "./runner";
import { load, save } from "./store";

const DID = "did:plc:test";

// Answers every call the runner makes without a network: an empty repo.
function signedIn(): OAuthSession {
  return {
    did: DID,
    fetchHandler: () =>
      Promise.resolve(
        new Response(JSON.stringify({ records: [] }), {
          headers: { "content-type": "application/json" },
        }),
      ),
  } as unknown as OAuthSession;
}

function card(): Owned {
  return {
    scryfallId: "0000-1111",
    finish: "nonfoil",
    quantity: 1,
    createdAt: "2026-09-30T00:00:00.000Z",
  };
}

function receipt(): Receipt {
  return {
    digest: "sha256-deadbeef",
    createdAt: "2026-09-30T00:00:00.000Z",
    source: "Scan",
  };
}

afterEach(async () => {
  await halt();
  await attach(null, () => null);
  database();
});

database();

test("signed out, nothing is written and the caller is told why", async () => {
  await attach(null, () => null);
  expect(await begin([card()], receipt())).toMatch(/signed in/i);
});

test("an empty list writes no job", async () => {
  await attach(signedIn(), () => []);
  expect(await begin([], receipt())).toMatch(/no cards/i);
  expect(await load(DID)).toBeNull();
});

test("a job written down is what null means", async () => {
  await attach(signedIn(), () => []);

  expect(await begin([card()], receipt())).toBeNull();
  const job = await load(DID);
  expect(job?.did).toBe(DID);
  expect(job?.total).toBe(1);
});

// The one the review turned up: a standing job owns the drain as well as the
// upload, and its remaining parts live nowhere else.
test("a job already standing is given way to, not taken over", async () => {
  await attach(signedIn(), () => []);
  await save({
    did: DID,
    receipt: null,
    parts: [],
    total: 4_333,
    dueAt: 0,
    misses: 0,
    paused: true,
  });

  expect(await begin([card()], receipt())).toMatch(/already under way/i);

  // Untouched: same total, still paused.
  const job = await load(DID);
  expect(job?.total).toBe(4_333);
  expect(job?.paused).toBe(true);
});
