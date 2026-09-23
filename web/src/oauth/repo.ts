import type { OAuthSession } from "@atproto/oauth-client-browser";
import type { BlobRef } from "../lexicons/app/manaweb/profile";

// A record as it is written: `$type` is added below, and a plain Omit would
// drop every named field past the open index signature a lexicon carries.
export type Fields<T> = {
  [K in keyof T as K extends "$type" ? never : K]: T[K];
};

// A record as the repo holds it: the value, plus what addresses and versions it.
export type Held<T> = { uri: string; cid: string; value: T };

type Page<T> = { records: Held<T>[]; cursor?: string };
type Written = { uri: string; cid: string };

// What one `applyWrites` call takes, and the call is one transaction: all of
// them land or none does. Exceeding either is charged before it is refused.
export const BATCH = 200;
export const BYTES = 1_000_000;

// What each write costs against the account's hourly and daily budgets. The
// call is charged the sum over its writes, so a batch buys round-trips and
// atomicity rather than headroom.
export const POINTS = { create: 3, update: 2, delete: 1 };

// Each write names its own collection, so one transaction can write records of
// one type and retire a record of another.
export type Write =
  | { action: "create"; collection: string; rkey?: string; value: object }
  | { action: "update"; collection: string; rkey: string; value: object }
  | { action: "delete"; collection: string; rkey: string };

// A failure the PDS named, so retrying it gets the same answer. A connection
// that never reached one is not this, whatever class the fetch stack threw.
export class Verdict extends Error {
  constructor(message: string, named: string) {
    super(message);
    this.name = named;
  }
}

// A refusal that says when to come back, which a paced job needs and a single
// write can ignore.
export class Refused extends Error {
  after: number;

  constructor(message: string, after: number) {
    super(message);
    this.name = "Refused";
    this.after = after;
  }
}

// The session resolves the account's own PDS, so a path is the whole address.
async function query<T>(
  session: OAuthSession,
  nsid: string,
  params: Record<string, string>,
): Promise<T> {
  const search = new URLSearchParams(params);
  return unwrap(await session.fetchHandler(`/xrpc/${nsid}?${search}`), nsid);
}

function send(
  session: OAuthSession,
  nsid: string,
  body: unknown,
): Promise<Response> {
  return session.fetchHandler(`/xrpc/${nsid}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function procedure<T>(
  session: OAuthSession,
  nsid: string,
  body: unknown,
): Promise<T> {
  return unwrap(await send(session, nsid, body), nsid);
}

// A status alone says nothing useful: the reason is in the body's `message`,
// and its `error` names the kind, which is what tells a verdict from a blip.
async function unwrap<T>(response: Response, nsid: string): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body as T;

  const said = body as { error?: string; message?: string } | null;
  const message = `${nsid}: ${said?.message ?? response.status}`;
  if (response.status === 429) throw new Refused(message, after(response));

  if (said?.error) throw new Verdict(message, said.error);
  throw new Error(message);
}

// Where a write landed, parallel to the writes that made it. A delete carries
// nothing, so the array is read by position rather than searched.
export type Result = { uri?: string; cid?: string };

// What a call wrote and what the account has left. `rev` is the repo's revision
// after it, which nothing asks a PDS for separately — see `docs/atproto.md`.
export type Applied = { results: Result[]; rev?: string; budget: Budget };

// What the PDS will still take, reported on every answer. Which of its buckets
// the figure belongs to is not said and does not matter — see `docs/atproto.md`.
export type Budget = { remaining: number; reset: number } | null;

function budget(response: Response): Budget {
  const remaining = Number(response.headers.get("ratelimit-remaining"));
  const reset = Number(response.headers.get("ratelimit-reset"));
  if (!(reset > 0) || !Number.isFinite(remaining)) return null;
  return { remaining, reset: reset * 1000 };
}

// `retry-after` counts seconds from now, `ratelimit-reset` names the second the
// window turns. Neither is promised, so a refusal saying nothing waits anyway.
function after(response: Response): number {
  const wait = Number(response.headers.get("retry-after"));
  if (wait > 0) return wait * 1000;

  const reset = Number(response.headers.get("ratelimit-reset"));
  if (reset > 0) return Math.max(reset * 1000 - Date.now(), 0);

  return 60_000;
}

// Bytes rather than JSON, which is the one call here that does not send a
// record. Its own scope too: `repo:` covers what names a blob, never the blob.
export async function uploadBlob(
  session: OAuthSession,
  body: Blob,
): Promise<BlobRef> {
  const nsid = "com.atproto.repo.uploadBlob";
  const response = await session.fetchHandler(`/xrpc/${nsid}`, {
    method: "POST",
    headers: { "content-type": body.type },
    body,
  });
  const said = await unwrap<{ blob: BlobRef }>(response, nsid);
  return said.blob;
}

// Every record in one collection, paged out in full.
export async function list<T>(
  session: OAuthSession,
  collection: string,
): Promise<Held<T>[]> {
  const held: Held<T>[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await query<Page<T>>(
      session,
      "com.atproto.repo.listRecords",
      {
        repo: session.did,
        collection,
        limit: "100",
        ...(cursor ? { cursor } : {}),
      },
    );
    held.push(...page.records);
    if (!page.cursor || page.records.length === 0) return held;
    cursor = page.cursor;
  }
}

// The server picks the key, which is a TID and therefore creation order.
export function create<T extends object>(
  session: OAuthSession,
  collection: string,
  record: T,
): Promise<Written> {
  return procedure(session, "com.atproto.repo.createRecord", {
    repo: session.did,
    collection,
    record: { $type: collection, ...record },
  });
}

export function put<T extends object>(
  session: OAuthSession,
  collection: string,
  key: string,
  record: T,
): Promise<Written> {
  return procedure(session, "com.atproto.repo.putRecord", {
    repo: session.did,
    collection,
    rkey: key,
    record: { $type: collection, ...record },
  });
}

// Writes of any kind, across any collections, as one transaction. The whole
// call is charged before either cap refuses it.
export async function applyWrites(
  session: OAuthSession,
  writes: Write[],
): Promise<Applied> {
  const nsid = "com.atproto.repo.applyWrites";
  const response = await send(session, nsid, {
    repo: session.did,
    writes: writes.map((one) => ({
      $type: `com.atproto.repo.applyWrites#${one.action}`,
      collection: one.collection,
      // Omitted on a create, which is what leaves the key to the server.
      ...(one.rkey ? { rkey: one.rkey } : {}),
      ...(one.action === "delete"
        ? {}
        : { value: { $type: one.collection, ...one.value } }),
    })),
  });

  const said = await unwrap<{
    results?: Result[];
    commit?: { rev?: string };
  }>(response, nsid);

  return {
    results: said?.results ?? [],
    rev: said?.commit?.rev,
    budget: budget(response),
  };
}

export function remove(
  session: OAuthSession,
  collection: string,
  key: string,
): Promise<unknown> {
  return procedure(session, "com.atproto.repo.deleteRecord", {
    repo: session.did,
    collection,
    rkey: key,
  });
}

// `at://did/collection/key`, of which only the last part addresses a write.
export function rkey(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

export { query };
