import { afterEach, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { landing, type Stack, shown } from "../collection/cards";
import type { Held } from "../oauth/repo";
import { database } from "../testing/idb";
import { PART } from "./part";
import { IMPORTED, type Receipt } from "./receipt";
import { attach, awaiting, halt, listen } from "./runner";

const DID = "did:plc:test";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

// A repo holding one part, which the drain's delete empties. Results come back
// parallel to the writes, as a PDS answers them.
function repo(held: Held<Receipt>[]): OAuthSession {
  let left = held;

  return {
    did: DID,
    fetchHandler: (url: string, init?: RequestInit) => {
      if (url.startsWith("/xrpc/com.atproto.repo.listRecords")) {
        return Promise.resolve(json({ records: left }));
      }

      if (url.startsWith("/xrpc/com.atproto.repo.applyWrites")) {
        const sent = JSON.parse(String(init?.body)) as {
          writes: { $type: string; collection: string }[];
        };
        left = [];
        return Promise.resolve(
          json({
            results: sent.writes.map((one, at) =>
              one.$type.endsWith("#delete")
                ? {}
                : { uri: `at://${DID}/${one.collection}/${at}`, cid: "cid" },
            ),
          }),
        );
      }

      return Promise.reject(new Error(`unasked: ${url}`));
    },
  } as unknown as OAuthSession;
}

function part(count: number): Held<Receipt> {
  return {
    uri: `at://${DID}/${IMPORTED}/one`,
    cid: "cid",
    value: {
      digest: "sha256-deadbeef",
      createdAt: "2026-10-07T00:00:00.000Z",
      source: "CSV",
      entries: Array.from({ length: count }, (_, at) => ({
        scryfallId: `card-${at}`,
        finish: "nonfoil",
        quantity: 1,
        createdAt: "2026-10-07T00:00:00.000Z",
      })),
    },
  };
}

// A drain runs off a tick nothing hands back, so what says it is over is the
// collection having the records rather than a promise.
async function drained(until: () => boolean): Promise<void> {
  for (let at = 0; at < 400 && !until(); at++) {
    await new Promise((wake) => setTimeout(wake, 5));
  }
  await new Promise((wake) => setTimeout(wake, 20));
}

afterEach(async () => {
  await halt();
  await attach(null, () => null);
  database();
});

database();

// The collection is the records plus what an import has yet to turn into
// records, and a drain moves a part's worth from one to the other.
test("every render during a drain counts the part's cards once", async () => {
  const records = new Map<string, Stack>();
  const stacks = () => [...records.values()];
  const seen: number[] = [];
  const sample = () =>
    seen.push(
      landing(stacks(), awaiting()).reduce((sum, one) => sum + shown(one), 0),
    );

  await attach(repo([part(PART)]), stacks, (written) => {
    for (const one of written) records.set(one.uri, one);
    // A render is owed to the next turn of the loop rather than to the call
    // that asked for it, so that is where the collection has to add up too.
    queueMicrotask(sample);
  });

  const stop = listen(sample);

  await drained(() => records.size === PART);
  stop();

  expect(records.size).toBe(PART);
  expect(seen.length).toBeGreaterThan(1);
  expect(seen.filter((count) => count !== PART)).toEqual([]);
});
