import { TID } from "@atproto/common-web";
import { joins, merge, type Owned, type Stack } from "../collection/cards";
import { rkey } from "../oauth/repo";

// One record the import writes, and whether the repo already holds it.
export type Step = { rkey: string; value: Owned; held: boolean };

// What an import comes to against the collection as it stands, for the one
// question asked before it starts: what this file does to the card count.
// Nothing here is written — the drain decides that again, against whatever the
// collection holds by then — so the keys are identity and reach no repo.
export function plan(imported: Owned[], held: Stack[], at: string): Step[] {
  const open = held.map((one) => ({ key: rkey(one.uri), value: one.value }));
  const steps = new Map<string, Step>();
  let key = "";

  for (const one of imported) {
    const into = open.find((other) => joins(other.value, one));

    if (into) {
      into.value = merge(into.value, one, at);
      steps.set(into.key, { rkey: into.key, value: into.value, held: true });
      continue;
    }

    key = TID.nextStr(key);
    steps.set(key, { rkey: key, value: one, held: false });
  }

  return [...steps.values()];
}

// What a plan does to the collection, in copies rather than records. A
// joining step already carries the copies it merged, so the file's own count
// is the difference and never the sum.
export type Weight = {
  records: number;
  fresh: number;
  joined: number;
  adding: number;
  before: number;
  after: number;
};

export function weigh(steps: Step[], held: Stack[]): Weight {
  const joining = new Set(
    steps.filter((one) => one.held).map((one) => one.rkey),
  );
  const before = copies(held.map((one) => one.value));
  const kept = copies(
    held.filter((one) => !joining.has(rkey(one.uri))).map((one) => one.value),
  );
  const after = kept + copies(steps.map((one) => one.value));

  return {
    records: steps.length,
    fresh: steps.length - joining.size,
    joined: joining.size,
    adding: after - before,
    before,
    after,
  };
}

function copies(values: Owned[]): number {
  return values.reduce((sum, one) => sum + one.quantity, 0);
}
