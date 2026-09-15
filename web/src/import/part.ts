import { TID } from "@atproto/common-web";
import {
  CARD,
  joins,
  merge,
  type Owned,
  type Stack,
  stack,
} from "../collection/cards";
import { BYTES, type Held, rkey, type Write } from "../oauth/repo";
import { IMPORTED, type Receipt } from "./receipt";

// A drain is the part's writes plus the one that retires the part, and
// `applyWrites` takes two hundred. Bytes bind first only where the cards carry
// full notes and histories, so the packer measures as well as counts.
export const PART = 199;
const ROOM = BYTES * 0.85;

// A file as records the repo will take now, rather than over the hours its
// cards need. Every part carries the same digest, so what is left of an import
// is what an import is.
export function pack(stacks: Owned[], of: Receipt): Receipt[] {
  const parts: Receipt[] = [];
  let entries: Owned[] = [];
  let bytes = 0;

  for (const one of stacks) {
    const size = JSON.stringify(one).length;
    if (
      entries.length >= PART ||
      (bytes + size > ROOM && entries.length > 0)
    ) {
      parts.push({ entries, digest: of.digest, createdAt: of.createdAt });
      entries = [];
      bytes = 0;
    }
    entries.push(one);
    bytes += size;
  }

  if (entries.length > 0) {
    parts.push({ entries, digest: of.digest, createdAt: of.createdAt });
  }
  return parts;
}

// Cards keyed by what makes them one stack, which is how an entry finds the
// record it belongs in however long ago the file naming it was read. What a
// drain just wrote comes second and wins: a render is not owed to it yet.
export function index(
  held: Stack[],
  later: Iterable<Stack> = [],
): Map<string, Stack> {
  const found = new Map<string, Stack>();
  for (const one of held) {
    const key = stack(one.value);
    if (!found.has(key)) found.set(key, one);
  }
  for (const one of later) found.set(stack(one.value), one);
  return found;
}

// One part retired: its cards and the part itself, in a single transaction.
// The delete is what makes a second attempt fail rather than duplicate.
export function drain(
  part: Held<Receipt>,
  held: Map<string, Stack>,
  did: string,
  at: string,
): { writes: Write[]; landed: Stack[] } {
  const found = new Map(held);
  const writes: Write[] = [];
  const landed: Stack[] = [];
  let key = "";

  for (const entry of part.value.entries ?? []) {
    const one = entry as Owned;
    const into = found.get(stack(one));
    const record = into?.value;

    if (into && record && joins(record, one)) {
      const value = merge(record, one, at);
      const next = { ...into, value };
      writes.push({
        action: "update",
        collection: CARD,
        rkey: rkey(into.uri),
        value,
      });
      landed.push(next);
      found.set(stack(value), next);
      continue;
    }

    key = TID.nextStr(key);
    const next = { uri: `at://${did}/${CARD}/${key}`, cid: "", value: one };
    writes.push({ action: "create", collection: CARD, rkey: key, value: one });
    landed.push(next);
    found.set(stack(one), next);
  }

  writes.push({
    action: "delete",
    collection: IMPORTED,
    rkey: rkey(part.uri),
  });
  return { writes, landed };
}

// What a part still owes, which is what progress is counted in: an import is
// its parts, and the repo is where they are.
export function owed(parts: Held<Receipt>[]): number {
  return parts.reduce((sum, one) => sum + (one.value.entries?.length ?? 0), 0);
}
