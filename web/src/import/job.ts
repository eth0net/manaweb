import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { CARD } from "../collection/cards";
import { applyWrites, BATCH, query, Refused, type Write } from "../oauth/repo";
import type { Step } from "./plan";
import { clear, type Job, load, save } from "./store";

// A create costs 3 points of an hourly 5,000, so 1,666 of them fit in an hour.
// Spacing the batches to just inside that beats being refused at it.
const POINTS = 3;
const BUDGET = 5000;
const HOURLY = Math.floor(BUDGET / POINTS);
export const SPACING = Math.ceil((BATCH * 3_600_000) / HOURLY);

export type State =
  | { at: "none" }
  | { at: "held"; done: number; total: number }
  | { at: "running"; done: number; total: number; until: number }
  | { at: "stopped"; done: number; total: number }
  | { at: "done"; total: number }
  | { at: "failed"; done: number; total: number; why: string };

export type Running = {
  state: State;
  start: (steps: Step[]) => void;
  resume: () => void;
  stop: () => void;
  discard: () => void;
};

// The import as it runs: one call per two hundred stacks, spaced to the hour's
// budget, and written down after each so a closed tab loses a batch at worst.
export function useImport(
  session: OAuthSession | null,
  landed: () => void,
): Running {
  const [state, setState] = useState<State>({ at: "none" });
  const job = useRef<Job | null>(null);
  const going = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waking = useRef<((go: boolean) => void) | null>(null);

  const halt = useCallback(() => {
    going.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    waking.current?.(false);
    waking.current = null;
  }, []);

  // A tab closed mid-import left one behind, and it belongs to whoever signed
  // in since only if that is the same account.
  useEffect(() => {
    let live = true;
    void load().then((found) => {
      if (!live || !found || found.did !== session?.did) return;
      job.current = found;
      setState({ at: "held", done: found.done, total: found.steps.length });
    });
    return () => {
      live = false;
    };
  }, [session]);

  useEffect(() => halt, [halt]);

  const rest = useCallback(
    (ms: number) =>
      new Promise<boolean>((wake) => {
        waking.current = wake;
        timer.current = setTimeout(() => {
          timer.current = null;
          waking.current = null;
          wake(going.current);
        }, ms);
      }),
    [],
  );

  const work = useCallback(async () => {
    if (!session) return;
    going.current = true;

    for (;;) {
      const held = job.current;
      if (!held || !going.current) break;

      if (held.done >= held.steps.length) {
        await clear();
        job.current = null;
        going.current = false;
        setState({ at: "done", total: held.steps.length });
        landed();
        return;
      }

      const batch = held.steps.slice(held.done, held.done + BATCH);
      const total = held.steps.length;
      setState({ at: "running", done: held.done, total, until: 0 });

      try {
        await applyWrites(session, CARD, batch.map(write));
      } catch (failure) {
        if (failure instanceof Refused) {
          setState({
            at: "running",
            done: held.done,
            total,
            until: Date.now() + failure.after,
          });
          if (!(await rest(failure.after))) break;
          continue;
        }
        going.current = false;
        setState({
          at: "failed",
          done: held.done,
          total,
          why: reason(failure),
        });
        return;
      }

      held.done += batch.length;
      try {
        await save(held);
      } catch (failure) {
        going.current = false;
        setState({
          at: "failed",
          done: held.done,
          total,
          why: reason(failure),
        });
        return;
      }

      if (held.done < total) {
        setState({
          at: "running",
          done: held.done,
          total,
          until: Date.now() + SPACING,
        });
        if (!(await rest(SPACING))) break;
      }
    }

    const held = job.current;
    if (held) {
      setState({ at: "stopped", done: held.done, total: held.steps.length });
    }
  }, [session, rest, landed]);

  const start = useCallback(
    (steps: Step[]) => {
      if (!session || steps.length === 0) return;
      const fresh: Job = { did: session.did, steps, done: 0 };
      job.current = fresh;

      // Written down before anything is, so a lost answer to the first call is
      // still a job something can resume.
      save(fresh).then(
        () => void work(),
        (failure: unknown) =>
          setState({
            at: "failed",
            done: 0,
            total: steps.length,
            why: reason(failure),
          }),
      );
    },
    [session, work],
  );

  const resume = useCallback(() => {
    const held = job.current;
    if (!session || !held) return;

    // Only the batch a resume begins on can be in doubt: a call whose answer
    // was lost had committed, and its creates would fail the whole batch a
    // second time. Asking after one of them is cheaper than finding out.
    void settled(session, held).then(() => work());
  }, [session, work]);

  const discard = useCallback(() => {
    halt();
    job.current = null;
    void clear();
    setState({ at: "none" });
  }, [halt]);

  const stop = useCallback(() => {
    const held = job.current;
    halt();
    if (held) {
      setState({ at: "stopped", done: held.done, total: held.steps.length });
    }
  }, [halt]);

  return { state, start, resume, stop, discard };
}

// Whether the batch a resume is about to send has already been written, which
// only a record it would create can answer.
async function settled(session: OAuthSession, held: Job): Promise<void> {
  const batch = held.steps.slice(held.done, held.done + BATCH);
  const made = batch.find((one) => !one.held);
  if (!made) return;

  try {
    await query(session, "com.atproto.repo.getRecord", {
      repo: session.did,
      collection: CARD,
      rkey: made.rkey,
    });
  } catch {
    return;
  }

  held.done += batch.length;
  await save(held);
}

function write(step: Step): Write {
  return {
    action: step.held ? "update" : "create",
    rkey: step.rkey,
    value: step.value,
  };
}

function reason(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
