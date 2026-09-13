import { TID } from "@atproto/common-web";
import { joins, merge, type Owned, type Stack } from "../collection/cards";
import { rkey } from "../oauth/repo";

// One record the import writes, and whether the repo already holds it.
export type Step = { rkey: string; value: Owned; held: boolean };

// What an import comes to against the collection as it stands. A stack
// matching one already there joins it, which is still a write but not a second
// stack, and keys are picked here so a batch replayed after a lost answer
// collides rather than duplicating.
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

// Copies, rather than records, which is the number anyone reads it as.
export function cards(steps: Step[]): number {
  return steps.reduce((sum, one) => sum + one.value.quantity, 0);
}
