import { expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { applyWrites, Refused, Verdict, type Write } from "./repo";

const WRITES: Write[] = [
  { action: "delete", collection: "app.manaweb.card", rkey: "x" },
];

// Only `fetchHandler` and `did` are reached, and typing the rest of a real
// session would be typing the library.
function session(fetchHandler: () => Promise<Response>): OAuthSession {
  return { did: "did:plc:x", fetchHandler } as unknown as OAuthSession;
}

function answers(status: number, body: unknown): OAuthSession {
  return session(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

test("an error the PDS named is a verdict", async () => {
  const now = answers(400, { error: "InvalidSwap", message: "no" });
  await expect(applyWrites(now, WRITES)).rejects.toBeInstanceOf(Verdict);
});

// The import pauses on a verdict and waits on anything else, so a connection
// that never reached a PDS must not arrive looking like one.
test("a connection that never landed is not a verdict", async () => {
  const now = session(() => Promise.reject(new TypeError("Failed to fetch")));
  await expect(applyWrites(now, WRITES)).rejects.toBeInstanceOf(TypeError);
  await expect(applyWrites(now, WRITES)).rejects.not.toBeInstanceOf(Verdict);
});

// A status with no `error` field is a gateway or a proxy talking, not the PDS.
test("a failure the PDS did not name is not a verdict", async () => {
  const now = answers(502, { message: "bad gateway" });
  await expect(applyWrites(now, WRITES)).rejects.not.toBeInstanceOf(Verdict);
});

test("a rate limit says when to come back", async () => {
  const now = answers(429, { error: "RateLimitExceeded", message: "slow" });
  await expect(applyWrites(now, WRITES)).rejects.toBeInstanceOf(Refused);
});
