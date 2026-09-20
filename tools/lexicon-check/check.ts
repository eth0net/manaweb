// Validates ../../lexicons against atproto's own lexicon implementation, then
// against records it has to accept and refuse, then the OAuth client metadata
// document against both.
//
//     bun install && bun run check
//
// The refusals are the point. A schema that accepts everything would pass a
// validity check on its own.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lexicons } from "@atproto/api";

const DIR = join(dirname(dirname(import.meta.dir)), "lexicons");

let failed = false;
const fail = (message: string) => {
  console.log(`  FAIL  ${message}`);
  failed = true;
};
const ok = (message: string) => console.log(`  ok    ${message}`);

// Seeded with every official schema, so refs to com.atproto.* resolve against
// the real definitions rather than a copy that can go stale.
const lex = lexicons;
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

console.log("schemas:");
for (const file of files) {
  const doc = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  if (doc.id !== file.replace(/\.json$/, "")) {
    fail(`${file}: id is "${doc.id}", so the filename does not name the NSID`);
  }
  try {
    lex.add(doc);
    ok(doc.id);
  } catch (error) {
    fail(`${doc.id}: ${(error as Error).message}`);
  }
}

console.log("\nrefs:");
const refs = new Set<string>();
const walk = (node: unknown, docId: string) => {
  if (Array.isArray(node)) {
    for (const one of node) walk(one, docId);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const qualify = (r: string) => (r.startsWith("#") ? docId + r : r);
  if (obj.type === "ref" && typeof obj.ref === "string")
    refs.add(qualify(obj.ref));
  if (obj.type === "union" && Array.isArray(obj.refs)) {
    for (const r of obj.refs) refs.add(qualify(r as string));
  }
  for (const one of Object.values(obj)) walk(one, docId);
};
for (const file of files) {
  const doc = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  walk(doc, doc.id);
}
for (const ref of [...refs].sort()) {
  try {
    lex.getDefOrThrow(ref);
    ok(ref);
  } catch {
    fail(`unresolved ref ${ref}`);
  }
}

const NOW = "2026-09-07T02:40:00.000Z";
const DID = "did:plc:sesxeihcsbjxpez2l4of7oie";
const SOURCE = {
  uri: `at://${DID}/app.manaweb.deck/3l4xk`,
  cid: "bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a",
};
const BOLT = "44623693-51d6-49ad-8cd7-140505caf02f";

const accepted: Array<[string, Record<string, unknown>]> = [
  [
    "a stack with only what is required",
    {
      $type: "app.manaweb.card",
      scryfallId: "435589bb-27c6-4a6d-9d63-394d5092b9d8",
      finish: "nonfoil",
      quantity: 1,
      createdAt: NOW,
    },
  ],
  [
    "a graded, filed, foil stack",
    {
      $type: "app.manaweb.card",
      scryfallId: "b68be6a7-0515-42e0-abe9-b3f14b118c19",
      finish: "foil",
      quantity: 3,
      condition: "nearMint",
      container: `at://${DID}/app.manaweb.container/3l4xm`,
      acquiredAt: NOW,
      createdAt: NOW,
    },
  ],
  [
    "a stack with provenance, a note and tags",
    {
      $type: "app.manaweb.card",
      scryfallId: BOLT,
      finish: "nonfoil",
      quantity: 2,
      acquisitions: [
        {
          at: NOW,
          quantity: 1,
          price: "0.90",
          currency: "GBP",
          marketValue: "27.18",
          marketCurrency: "EUR",
        },
        { quantity: 1, marketValue: "26.40", marketCurrency: "EUR" },
      ],
      updatedAt: NOW,
      note: "042/500, bought at GP Bristol",
      tags: ["signed", "altered", "sleeved-in-the-good-ones"],
      proxy: false,
      createdAt: NOW,
    },
  ],
  [
    "a container",
    {
      $type: "app.manaweb.container",
      name: "Trade binder",
      kind: "binder",
      createdAt: NOW,
    },
  ],
  [
    "a deck that is still just a concept",
    {
      $type: "app.manaweb.deck",
      name: "Jinnie Fay tokens",
      createdAt: NOW,
    },
  ],
  [
    "a built commander deck, forked, with history",
    {
      $type: "app.manaweb.deck",
      name: "Jetmir",
      format: "commander",
      container: `at://${DID}/app.manaweb.container/3l4xm`,
      archived: false,
      visibility: "unlisted",
      forkedFrom: {
        source: SOURCE,
        snapshot: `at://${DID}/app.manaweb.snapshot/3l4xn`,
      },
      entries: [
        {
          oracleId: "61fbaaf2-4286-4e9a-b9cb-aa31262b596a",
          quantity: 1,
          section: "commander",
        },
        {
          oracleId: "43b5e462-d860-473d-828f-6c513fc7768a",
          scryfallId: "0004311b-646a-4df8-a4b4-9171642e9ef4",
          finish: "foil",
          quantity: 1,
        },
        { oracleId: BOLT, quantity: 4, section: "main" },
      ],
      recentChanges: [
        {
          at: NOW,
          op: "setQuantity",
          previousQuantity: 2,
          entry: { oracleId: BOLT, quantity: 4 },
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  [
    "a wishlist",
    {
      $type: "app.manaweb.list",
      name: "Want",
      purpose: "wishlist",
      entries: [{ oracleId: BOLT, quantity: 1 }],
      createdAt: NOW,
    },
  ],
  [
    "a named snapshot",
    {
      $type: "app.manaweb.snapshot",
      subject: SOURCE,
      name: "Pre-rotation",
      entries: [{ oracleId: BOLT, quantity: 1 }],
      createdAt: NOW,
    },
  ],
  // knownValues, not enum: a value Scryfall adds later must stay writable.
  [
    "a finish this schema has never heard of",
    {
      $type: "app.manaweb.card",
      scryfallId: BOLT,
      finish: "surgeFoil",
      quantity: 1,
      createdAt: NOW,
    },
  ],
  [
    "a format this schema has never heard of",
    {
      $type: "app.manaweb.deck",
      name: "Whatever comes next",
      format: "someFutureFormat",
      createdAt: NOW,
    },
  ],
];

const refused: Array<[string, Record<string, unknown>]> = [
  [
    "a stack with no finish, which would break stack identity",
    {
      $type: "app.manaweb.card",
      scryfallId: BOLT,
      quantity: 1,
      createdAt: NOW,
    },
  ],
  [
    "a stack of zero, which should be a delete",
    {
      $type: "app.manaweb.card",
      scryfallId: BOLT,
      finish: "foil",
      quantity: 0,
      createdAt: NOW,
    },
  ],
  [
    "a design entry with no oracleId, unusable for legality",
    {
      $type: "app.manaweb.deck",
      name: "d",
      entries: [{ scryfallId: BOLT, quantity: 1 }],
      createdAt: NOW,
    },
  ],
  [
    "a container with an empty name",
    {
      $type: "app.manaweb.container",
      name: "",
      createdAt: NOW,
    },
  ],
  [
    "a snapshot of nothing",
    {
      $type: "app.manaweb.snapshot",
      entries: [],
      createdAt: NOW,
    },
  ],
  [
    "a snapshot subject with no cid, which would not pin a version",
    {
      $type: "app.manaweb.snapshot",
      subject: { uri: SOURCE.uri },
      entries: [],
      createdAt: NOW,
    },
  ],
  [
    "a fork source that is a bare uri rather than a strongRef",
    {
      $type: "app.manaweb.deck",
      name: "d",
      forkedFrom: { source: SOURCE.uri },
      createdAt: NOW,
    },
  ],
  [
    "a proxy flag that is a string rather than a boolean",
    {
      $type: "app.manaweb.card",
      scryfallId: BOLT,
      finish: "foil",
      quantity: 1,
      proxy: "yes",
      createdAt: NOW,
    },
  ],
  [
    "a currency that is not a three-letter code",
    {
      $type: "app.manaweb.card",
      scryfallId: BOLT,
      finish: "foil",
      quantity: 1,
      acquisitions: [{ quantity: 1, price: "1.00", currency: "pounds" }],
      createdAt: NOW,
    },
  ],
  [
    "an acquisition of no copies",
    {
      $type: "app.manaweb.card",
      scryfallId: BOLT,
      finish: "foil",
      quantity: 1,
      acquisitions: [{ quantity: 0, price: "1.00", currency: "GBP" }],
      createdAt: NOW,
    },
  ],
  [
    "an acquisition that is a bare number",
    {
      $type: "app.manaweb.card",
      scryfallId: BOLT,
      finish: "foil",
      quantity: 1,
      acquisitions: [3],
      createdAt: NOW,
    },
  ],
  [
    "a container reference that is a bare rkey",
    {
      $type: "app.manaweb.card",
      scryfallId: BOLT,
      finish: "foil",
      quantity: 1,
      container: "3l4xk",
      createdAt: NOW,
    },
  ],
];

console.log("\nrecords that must validate:");
for (const [label, record] of accepted) {
  try {
    lex.assertValidRecord(record.$type as string, record);
    ok(label);
  } catch (error) {
    fail(`${label}: ${(error as Error).message}`);
  }
}

console.log("\nrecords that must be refused:");
for (const [label, record] of refused) {
  try {
    lex.assertValidRecord(record.$type as string, record);
    fail(`${label}: accepted, but should not be`);
  } catch (error) {
    ok(`${label} — ${(error as Error).message}`);
  }
}

// A seed stops halfway through on a broken record, having written some.
const FIXTURES = join(dirname(dirname(import.meta.dir)), "fixtures/records");
const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

console.log("\nfixture records:");
for (const collection of readdirSync(FIXTURES).sort()) {
  for (const file of readdirSync(join(FIXTURES, collection)).sort()) {
    const at = `${collection}/${file}`;
    const record = JSON.parse(
      readFileSync(join(FIXTURES, collection, file), "utf8"),
    );
    if (record.$type !== collection) {
      fail(`${at}: $type is "${record.$type}", so the directory misnames it`);
      continue;
    }
    if (!TID.test(file.replace(/\.json$/, ""))) {
      fail(
        `${at}: the filename is the record key, which this schema wants as a tid`,
      );
      continue;
    }
    try {
      lex.assertValidRecord(collection, record);
      ok(at);
    } catch (error) {
      fail(`${at}: ${(error as Error).message}`);
    }
  }
}

// The client metadata document. It is committed rather than generated, because
// the client imports these same bytes to decide what to request, so this is
// where the two are held to each other. See docs/atproto.md.
const OAUTH = join(
  dirname(dirname(import.meta.dir)),
  "web/public/oauth/client-metadata.json",
);
const client = JSON.parse(readFileSync(OAUTH, "utf8"));
const scopes: string[] = client.scope.split(" ");

console.log("\nclient metadata:");
const expect = (label: string, condition: boolean, detail = "") =>
  condition ? ok(label) : fail(`${label}${detail && ` — ${detail}`}`);

expect(
  "client_uri is the parent of client_id",
  client.client_id === `${client.client_uri}/oauth/client-metadata.json`,
  `${client.client_id} under ${client.client_uri}`,
);
expect(
  "every redirect_uri is https",
  client.redirect_uris.every((uri: string) => uri.startsWith("https://")),
);
expect(
  "a browser client authenticates with none",
  client.token_endpoint_auth_method === "none",
);
expect("tokens are DPoP-bound", client.dpop_bound_access_tokens === true);
expect("atproto comes first in scope", scopes[0] === "atproto");
expect(
  "no repo: scope globs a prefix, which repo: does not support",
  !scopes.some((scope) => scope.startsWith("repo:") && scope.includes("*")),
);

// The document asks for no more than it can write. A record type may exist
// without a scope — it runs ahead of its implementation — but a scope for a
// record type that does not exist is authority taken for nothing.
const records = new Set<string>();
for (const file of files) {
  const doc = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  if (doc.defs?.main?.type === "record") records.add(doc.id);
}
for (const scope of scopes) {
  if (!scope.startsWith("repo:")) continue;
  const nsid = scope.slice("repo:".length).split("?")[0] ?? "";
  expect(`${scope} names a record type that exists`, records.has(nsid));
}

// A record's `record` cannot be a ref, so an import entry has to restate the
// card's shape. Nothing stops the two drifting except this.
{
  const card = JSON.parse(
    readFileSync(join(DIR, "app.manaweb.card.json"), "utf8"),
  );
  const bulk = JSON.parse(
    readFileSync(join(DIR, "app.manaweb.import.json"), "utf8"),
  );
  const written = card.defs.main.record.properties;
  const planned = bulk.defs.entry.properties;

  // `updatedAt` is the one field a plan cannot carry: nothing has amended it.
  const expected = Object.keys(written).filter((name) => name !== "updatedAt");
  expect(
    "an import entry holds every field a card does",
    expected.every((name) => name in planned) &&
      Object.keys(planned).every((name) => expected.includes(name)),
  );
  for (const name of expected) {
    const same =
      JSON.stringify(written[name]) ===
      JSON.stringify(planned[name]).replaceAll("app.manaweb.card#", "#");
    expect(`an import entry's ${name} matches the card's`, same);
  }
}

console.log(failed ? "\nFAILED" : "\nall green");
process.exit(failed ? 1 : 0);
