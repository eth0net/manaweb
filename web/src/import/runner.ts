import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useCallback, useSyncExternalStore } from "react";
import { CARD } from "../collection/cards";
import {
  applyWrites,
  BATCH,
  type Budget,
  BYTES,
  POINTS,
  query,
  Refused,
  type Write,
} from "../oauth/repo";
import type { Step } from "./plan";
import { clear, type Job, load, save } from "./store";

// A create costs 3 points of an hourly 5,000, so 1,666 fit in an hour. Nothing
// paces off this: it is what an import is quoted at before one has run.
export const HOURLY = Math.floor(5000 / POINTS.create);

// Deadlines are read rather than slept through, because a browser honors no
// timer it doesn't feel like honoring. A tick this short costs nothing and
// Chrome floors it at a minute in a hidden tab, which is a minute of lateness.
const TICK = 20_000;

// Answers that never came, before an import stops calling it a blip.
const MISSES = 10;

// One tab writes at a time. Held for a step rather than for the whole import,
// so a tab that dies between steps blocks nobody.
const LOCK = "manaweb-import";

export type State =
  | { at: "none" }
  | { at: "running"; done: number; total: number; due: number }
  | { at: "stopped"; done: number; total: number }
  | { at: "done"; total: number }
  | { at: "failed"; done: number; total: number; why: string };

let state: State = { at: "none" };
let session: OAuthSession | null = null;
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

async function tick(): Promise<void> {
  if (stepping || !session) return;
  stepping = true;
  try {
    await locked(step);
  } finally {
    stepping = false;
  }
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
  const job = await load();
  if (!job || job.did !== now.did || job.paused) {
    ticks(false);
    return;
  }

  if (job.done >= job.steps.length) {
    await clear();
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
      announce({ at: "running", done: job.done, total, due: 0 });
    }
    return;
  }

  if (Date.now() < job.dueAt) {
    announce({ at: "running", done: job.done, total, due: job.dueAt });
    return;
  }

  announce({ at: "running", done: job.done, total, due: 0 });
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

  if (stopping) {
    ticks(false);
    announce({ at: "stopped", done: job.done, total });
    return;
  }
  announce({ at: "running", done: job.done, total, due: job.dueAt });
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
    if (await keep(job, mine)) {
      announce({ at: "running", done: job.done, total, due: job.dueAt });
    }
    return;
  }

  if (named(failure) || job.misses + 1 >= MISSES) {
    job.paused = true;
    if (await keep(job, mine)) {
      ticks(false);
      announce({ at: "failed", done: job.done, total, why: reason(failure) });
    }
    return;
  }

  job.misses += 1;
  job.dueAt = Date.now() + TICK * job.misses;

  if (await keep(job, mine)) {
    announce({ at: "running", done: job.done, total, due: job.dueAt });
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

function write(step: Step): Write {
  return {
    action: step.held ? "update" : "create",
    rkey: step.rkey,
    value: step.value,
  };
}

// Adopts whatever the last visit left and carries on with it, so an import
// resumes because the app opened rather than because a page was found.
export async function attach(now: OAuthSession | null): Promise<void> {
  session = now;
  if (!now) {
    ticks(false);
    announce({ at: "none" });
    return;
  }

  const job = await load();
  if (!job || job.did !== now.did) return;

  const total = job.steps.length;
  if (job.paused) {
    announce({ at: "stopped", done: job.done, total });
    return;
  }

  announce({ at: "running", done: job.done, total, due: job.dueAt });
  ticks(true);
  void tick();
}

export async function begin(steps: Step[]): Promise<void> {
  if (!session || steps.length === 0) return;
  stopping = false;

  const job: Job = {
    did: session.did,
    steps,
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

  announce({ at: "running", done: 0, total: steps.length, due: 0 });
  ticks(true);
  void tick();
}

export async function carryOn(): Promise<void> {
  stopping = false;
  const job = await load();
  if (!job) return;

  job.paused = false;
  job.misses = 0;
  await save(job);
  announce({
    at: "running",
    done: job.done,
    total: job.steps.length,
    due: job.dueAt,
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
  if (stepping) return;

  const job = await load();
  if (!job) return;

  job.paused = true;
  await save(job);
  announce({ at: "stopped", done: job.done, total: job.steps.length });
}

export async function drop(): Promise<void> {
  era += 1;
  stopping = false;
  ticks(false);
  await clear();
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
