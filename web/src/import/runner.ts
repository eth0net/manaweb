import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useCallback, useSyncExternalStore } from "react";
import { CARD, type Owned } from "../collection/cards";
import {
  applyWrites,
  BATCH,
  type Budget,
  BYTES,
  create,
  type Held,
  POINTS,
  query,
  Refused,
  type Write,
} from "../oauth/repo";
import type { Step } from "./plan";
import { IMPORTED, type Receipt } from "./receipt";
import { clear, type Job, load, save } from "./store";

// A create costs 3 points of an hourly 5,000, so 1,666 fit in an hour. Nothing
// paces off this: it is what an import is quoted at before one has run.
export const HOURLY = Math.floor(5000 / POINTS.create);

// Deadlines are read rather than slept through, because a browser honors no
// timer it doesn't feel like honoring. A tick this short costs nothing and
// Chrome floors it at a minute in a hidden tab, which is a minute of lateness.
const TICK = 20_000;

// Backoff for answers that never came, and how many of those make a silence
// worth reporting. Nothing here ends an import: a PDS restarted overnight is
// not a reason to abandon five hours of work, and only a verdict is.
const BACKOFF = 30 * 60_000;
const QUIET = 5;

// One tab writes at a time. Held for a step rather than for the whole import,
// so a tab that dies between steps blocks nobody.
const LOCK = "manaweb-import";

export type State =
  | { at: "none" }
  | {
      at: "running";
      done: number;
      total: number;
      due: number;
      // The PDS has stopped answering. Not a failure, and not yet nothing.
      quiet: boolean;
    }
  | { at: "stopped"; done: number; total: number }
  | { at: "done"; total: number }
  | { at: "failed"; done: number; total: number; why: string };

let state: State = { at: "none" };
let session: OAuthSession | null = null;
// What to do with records once they are in the repo. The collection takes
// them, so a view that would otherwise re-read the lot learns them a batch at
// a time.
let report: ((written: Held<Owned>[]) => void) | null = null;
let ticking: ReturnType<typeof setInterval> | null = null;
let stepping = false;
// Discarding cannot reach into a call already out, so a step that comes back to
// find the era moved on writes nothing down. Stopping is the opposite: the
// batch did land, and saying so is the last thing it does.
let era = 0;
let stopping = false;
const watching = new Set<() => void>();

function announce(next: State): void {
  state = next;
  for (const watcher of watching) watcher();
}

// The tab holds a job open, so leaving is worth a question. Only while one is
// actually running: a listener left registered would ask after nothing.
function guard(event: BeforeUnloadEvent): void {
  event.preventDefault();
}

function ticks(on: boolean): void {
  if (on === (ticking !== null)) return;

  if (on) {
    ticking = setInterval(() => void tick(), TICK);
    addEventListener("beforeunload", guard);
    addEventListener("visibilitychange", wake);
    addEventListener("online", wake);
  } else {
    if (ticking) clearInterval(ticking);
    ticking = null;
    removeEventListener("beforeunload", guard);
    removeEventListener("visibilitychange", wake);
    removeEventListener("online", wake);
  }
}

// Hidden tabs are throttled and sleeping ones stop, so coming back is itself a
// reason to look at the clock rather than waiting for the next tick.
function wake(): void {
  if (document.visibilityState === "visible") void tick();
}

// An hour's budget is eight calls, and waiting a tick between them turns
// sixteen seconds of someone's attention into three minutes of it. So batches
// run back to back for as long as the budget allows, bounded in case a PDS
// answers that the window has already turned and then refuses anyway.
const BURST = 16;

async function tick(): Promise<void> {
  if (stepping || !session) return;
  stepping = true;
  try {
    for (let at = 0; at < BURST; at++) {
      await locked(step);
      if (!due()) break;
    }
  } finally {
    stepping = false;
  }
}

function due(): boolean {
  return ticking !== null && state.at === "running" && state.due <= Date.now();
}

// Two tabs both ticking is fine as long as one writes at a time, which is what
// makes the stored job the truth and memory only what gets rendered.
async function locked(work: () => Promise<void>): Promise<void> {
  if (!navigator.locks) return work();
  await navigator.locks.request(LOCK, { ifAvailable: true }, async (held) => {
    if (held) await work();
  });
}

// Writes the job down unless it has been discarded since, folding in a stop
// that arrived while the call was out.
async function keep(job: Job, mine: number): Promise<boolean> {
  if (era !== mine) return false;
  if (stopping) job.paused = true;
  await save(job);
  return true;
}

async function step(): Promise<void> {
  const now = session;
  if (!now) return;

  const mine = era;
  const job = await load(now.did);
  if (!job || job.paused) {
    ticks(false);
    return;
  }

  if (job.done >= job.steps.length) {
    if (!(await filed(now, job, mine))) return;
    await clear(now.did);
    ticks(false);
    announce({ at: "done", total: job.steps.length });
    return;
  }

  const total = job.steps.length;
  const batch = job.steps
    .slice(job.done, job.done + BATCH)
    .slice(0, fits(job));

  // A call whose answer was lost had either committed or not, and only the
  // record it would create can say which.
  if (job.pending) {
    const seen = await landed(now, batch);
    if (seen === null) return;
    if (seen) job.done += batch.length;
    job.pending = false;
    if (await keep(job, mine)) {
      announce({ at: "running", done: job.done, total, due: 0, quiet: false });
    }
    return;
  }

  if (Date.now() < job.dueAt) {
    announce({
      at: "running",
      done: job.done,
      total,
      due: job.dueAt,
      quiet: job.misses >= QUIET,
    });
    return;
  }

  announce({ at: "running", done: job.done, total, due: 0, quiet: false });
  job.pending = true;
  if (!(await keep(job, mine))) return;

  let budget: Budget;
  try {
    budget = await applyWrites(now, CARD, batch.map(write));
  } catch (failure) {
    await refused(job, mine, failure, total);
    return;
  }

  job.done += batch.length;
  job.pending = false;
  job.misses = 0;
  job.dueAt = Date.now() + spacing(budget, batch);
  if (!(await keep(job, mine))) return;

  report?.(batch.map((one) => written(now.did, one)));

  if (stopping) {
    ticks(false);
    announce({ at: "stopped", done: job.done, total });
    return;
  }
  announce({
    at: "running",
    done: job.done,
    total,
    due: job.dueAt,
    quiet: false,
  });
}

// The receipt is the only thing that remembers this file was taken, so a
// refusal on the last write of all is worth coming back for.
async function filed(
  now: OAuthSession,
  job: Job,
  mine: number,
): Promise<boolean> {
  if (!job.receipt) return true;

  try {
    await create(now, IMPORTED, job.receipt);
    return true;
  } catch (failure) {
    // The cards all landed, so a PDS refusing the receipt outright ends the
    // import without one rather than ending it in failure.
    if (named(failure)) return true;
    await refused(job, mine, failure, job.steps.length);
    return false;
  }
}

// A refusal is an answer and says when to come back. Anything that isn't an
// answer at all is the network, which is worth waiting out; anything the PDS
// named is a verdict, which is not.
async function refused(
  job: Job,
  mine: number,
  failure: unknown,
  total: number,
) {
  job.pending = false;

  // A refusal is an answer and carries its own wait, so it is never the end of
  // an import however many of them arrive.
  if (failure instanceof Refused) {
    job.dueAt = Date.now() + failure.after;
    job.misses = 0;
    if (await keep(job, mine)) {
      announce({
        at: "running",
        done: job.done,
        total,
        due: job.dueAt,
        quiet: false,
      });
    }
    return;
  }

  if (named(failure)) {
    job.paused = true;
    if (await keep(job, mine)) {
      ticks(false);
      announce({ at: "failed", done: job.done, total, why: reason(failure) });
    }
    return;
  }

  job.misses += 1;
  job.dueAt = Date.now() + Math.min(TICK * job.misses, BACKOFF);

  if (await keep(job, mine)) {
    announce({
      at: "running",
      done: job.done,
      total,
      due: job.dueAt,
      quiet: job.misses >= QUIET,
    });
  }
}

// What the PDS says it will still take, or nothing to wait for where it reports
// no limit at all. Its figure is points against whichever bucket is tightest,
// so a batch that fits inside what is left needs no pause before it.
function spacing(budget: Budget, batch: Step[]): number {
  if (!budget) return 0;
  return budget.remaining > cost(batch)
    ? 0
    : Math.max(budget.reset - Date.now(), 0);
}

function cost(batch: Step[]): number {
  return batch.reduce(
    (sum, one) => sum + (one.held ? POINTS.update : POINTS.create),
    0,
  );
}

// The body limit binds before the count does once stacks carry notes, tags and
// a history, so the batch is whatever fits under both.
function fits(job: Job): number {
  let bytes = 0;
  let taken = 0;

  for (const one of job.steps.slice(job.done, job.done + BATCH)) {
    bytes += JSON.stringify(one.value).length + one.rkey.length + 128;
    if (bytes > BYTES * 0.9 && taken > 0) break;
    taken += 1;
  }
  return taken;
}

// Whether the batch in doubt was written. Null where asking failed, which is
// not an answer either way and leaves the doubt for the next tick.
async function landed(
  now: OAuthSession,
  batch: Step[],
): Promise<boolean | null> {
  const made = batch.find((one) => !one.held);
  if (!made) return false;

  try {
    await query(now, "com.atproto.repo.getRecord", {
      repo: now.did,
      collection: CARD,
      rkey: made.rkey,
    });
    return true;
  } catch (failure) {
    return named(failure) ? false : null;
  }
}

function named(failure: unknown): boolean {
  return failure instanceof Error && failure.name !== "Error";
}

function reason(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

// A step as the repo now holds it. The cid is the one thing a write knows and
// a plan does not, and nothing local reads it.
function written(did: string, step: Step): Held<Owned> {
  return {
    uri: `at://${did}/${CARD}/${step.rkey}`,
    cid: "",
    value: step.value,
  };
}

function write(step: Step): Write {
  return {
    action: step.held ? "update" : "create",
    rkey: step.rkey,
    value: step.value,
  };
}

// Adopts whatever the last visit left and carries on with it, so an import
// resumes because the app opened rather than because a page was found.
export async function attach(
  now: OAuthSession | null,
  onWritten?: (written: Held<Owned>[]) => void,
): Promise<void> {
  session = now;
  report = onWritten ?? null;
  if (!now) {
    ticks(false);
    announce({ at: "none" });
    return;
  }

  const job = await load(now.did);
  if (!job) return;

  const total = job.steps.length;
  if (job.paused) {
    announce({ at: "stopped", done: job.done, total });
    return;
  }

  announce({
    at: "running",
    done: job.done,
    total,
    due: job.dueAt,
    quiet: job.misses >= QUIET,
  });
  ticks(true);
  void tick();
}

export async function begin(steps: Step[], receipt: Receipt): Promise<void> {
  if (!session || steps.length === 0) return;
  stopping = false;

  const job: Job = {
    did: session.did,
    steps,
    receipt,
    done: 0,
    dueAt: 0,
    pending: false,
    misses: 0,
    paused: false,
  };

  // Written down before anything is, so a lost answer to the first call is
  // still a job something can pick up.
  try {
    await save(job);
  } catch (failure) {
    announce({
      at: "failed",
      done: 0,
      total: steps.length,
      why: reason(failure),
    });
    return;
  }

  announce({
    at: "running",
    done: 0,
    total: steps.length,
    due: 0,
    quiet: false,
  });
  ticks(true);
  void tick();
}

export async function carryOn(): Promise<void> {
  if (!session) return;
  stopping = false;
  const job = await load(session.did);
  if (!job) return;

  job.paused = false;
  job.misses = 0;
  await save(job);
  announce({
    at: "running",
    done: job.done,
    total: job.steps.length,
    due: job.dueAt,
    quiet: false,
  });
  ticks(true);
  void tick();
}

export async function halt(): Promise<void> {
  stopping = true;
  ticks(false);
  if (state.at === "running") {
    announce({ at: "stopped", done: state.done, total: state.total });
  }

  // A call already out records the stop itself, along with whatever it landed.
  if (stepping || !session) return;

  const job = await load(session.did);
  if (!job) return;

  job.paused = true;
  await save(job);
  announce({ at: "stopped", done: job.done, total: job.steps.length });
}

export async function drop(): Promise<void> {
  era += 1;
  stopping = false;
  ticks(false);
  if (session) await clear(session.did);
  announce({ at: "none" });
}

export function useImport(): State {
  return useSyncExternalStore(
    useCallback((watcher: () => void) => {
      watching.add(watcher);
      return () => void watching.delete(watcher);
    }, []),
    () => state,
  );
}
