import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useSyncExternalStore } from "react";
import type { Owned, Stack } from "../collection/cards";
import {
  type Applied,
  applyWrites,
  BATCH,
  type Budget,
  BYTES,
  type Held,
  list,
  POINTS,
  Refused,
  remove,
  rkey,
  Verdict,
  type Write,
} from "../oauth/repo";
import { drain, index, key, landed, owed, PART, pack, without } from "./part";
import { IMPORTED, type Receipt } from "./receipt";
import { clear, type Job, load, save } from "./store";

// A part costs its cards plus the write that retires it, so eight of them fit
// in an hourly 5,000 and carry 1,592 cards between them. Nothing paces off
// this: it is what an import is quoted at before one has run.
const DRAIN = PART * POINTS.create + POINTS.delete;
export const HOURLY = Math.floor(5000 / DRAIN) * PART;

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
  // The upload is the only part of an import held on one device, so it says so
  // separately from the hours of writing that follow it.
  | { at: "uploading"; done: number; total: number }
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
// The collection as it stands, which the drain resolves each entry against.
// Null until the repo itself has answered.
let holdings: (() => Stack[] | null) | null = null;
// What to do with records once they are in the repo. The collection takes
// them, so a view that would otherwise re-read the lot learns them a batch at
// a time.
let report: ((written: Stack[]) => void) | null = null;
// Parts the repo holds, newest read last. The repo is the truth and this is
// what saves asking it again between every write.
let pending: Held<Receipt>[] = [];
// Every key under the collection as of the last listing, receipts included,
// which is what says whether a call that never answered landed anyway.
let taken = new Set<string>();
// The cards inside them, for the collection to show. Recomputed rather than
// derived on read, so a subscriber gets one stable value per change.
let waiting: Owned[] = [];

function holding(parts: Held<Receipt>[]): void {
  pending = parts;
  waiting = parts.flatMap((one) => (one.value.entries ?? []) as Owned[]);
  notify();
}
// What this runner wrote and the collection has not rendered back yet. Parts
// run back to back, and React state does not update between two of them.
let recent = new Map<string, Stack>();
// What the imports still draining came to, taken from their receipts, so a
// device that never saw the file counts from the whole and not from the rest.
let planned = 0;
// The instant the current wait ends, mirrored out of the stored job so a burst
// can tell whether the next call is owed one.
let until = 0;
let ticking: ReturnType<typeof setInterval> | null = null;
let stepping = false;
// Discarding cannot reach into a call already out, so a step that comes back to
// find the era moved on writes nothing down. Stopping is the opposite: the
// batch did land, and saying so is the last thing it does.
let era = 0;
let stopping = false;
const watching = new Set<() => void>();

function notify(): void {
  for (const watcher of watching) watcher();
}

function announce(next: State): void {
  state = next;
  ask(next.at === "uploading");
  notify();
}

// Closing the tab only costs an upload, so only an upload is worth asking about.
let guarding = false;

function guard(event: BeforeUnloadEvent): void {
  event.preventDefault();
}

function ask(on: boolean): void {
  if (on === guarding) return;
  guarding = on;
  if (on) addEventListener("beforeunload", guard);
  else removeEventListener("beforeunload", guard);
}

function ticks(on: boolean): void {
  if (on === (ticking !== null)) return;

  if (on) {
    ticking = setInterval(() => void tick(), TICK);
    addEventListener("visibilitychange", wake);
    addEventListener("online", wake);
  } else {
    if (ticking) clearInterval(ticking);
    ticking = null;
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
    // A stop that arrived mid-step is left to the step to record, and three
    // of its paths return before they write the job down. Recording it here
    // instead is what keeps the stop from lasting only as long as the tab.
    if (stopping) await halt();
  }
}

function due(): boolean {
  if (ticking === null) return false;
  if (state.at !== "uploading" && state.at !== "running") return false;
  return until <= Date.now();
}

// Two tabs both ticking is fine as long as one writes at a time, which is what
// makes the stored job the truth and memory only what gets rendered.
async function locked(work: () => Promise<void>): Promise<void> {
  if (!navigator.locks) return work();
  await navigator.locks.request(LOCK, { ifAvailable: true }, async (held) => {
    if (held) await work();
  });
}

// For a person waiting on it rather than a tick: a step is one call, so this
// waits its turn instead of giving up and doing nothing.
async function queued(work: () => Promise<void>): Promise<void> {
  if (!navigator.locks) return work();
  await navigator.locks.request(LOCK, work);
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

  until = job.dueAt;
  if (job.receipt || job.parts.length > 0) return upload(now, job, mine);
  return sink(now, job, mine);
}

// The whole file into the repo, receipt first so a part is never an orphan.
// Parts are few and large, so what fits in one call is measured, not counted.
async function upload(
  now: OAuthSession,
  job: Job,
  mine: number,
): Promise<void> {
  announce({ at: "uploading", done: sent(job), total: job.total });
  if (Date.now() < job.dueAt) return;

  // A call whose answer never came may have landed anyway, and a part is keyed
  // by what it holds, so the repo says which did. Dropping those is what lets
  // the retry finish the upload instead of colliding with itself.
  if (job.misses > 0) {
    if (!(await refresh(now))) return;
    if (job.receipt && taken.has(await key(job.receipt))) job.receipt = null;

    const keyed = await Promise.all(
      job.parts.map(async (one) => ({ one, held: taken.has(await key(one)) })),
    );
    job.parts = keyed.filter((each) => !each.held).map((each) => each.one);
    job.misses = 0;

    if (!job.receipt && job.parts.length === 0) {
      await keep(job, mine);
      return;
    }
  }

  const taking = job.receipt ? [job.receipt] : job.parts.slice(0, room(job));

  let applied: Applied;
  try {
    applied = await applyWrites(now, await Promise.all(taking.map(part)));
  } catch (failure) {
    await refused(job, mine, failure);
    return;
  }

  if (job.receipt) job.receipt = null;
  else job.parts = job.parts.slice(taking.length);

  job.misses = 0;
  job.dueAt =
    Date.now() + spacing(applied.budget, taking.length * POINTS.create);
  if (!(await keep(job, mine))) return;

  // Every part just written has to be found before it can be drained, and one
  // listing covers however many calls the upload took.
  if (job.parts.length === 0) holding([]);
  announce({ at: "uploading", done: sent(job), total: job.total });
}

// Keyed by its own contents rather than left to the server, so a re-send is
// refused rather than written twice — see `key`.
async function part(value: Receipt): Promise<Write> {
  return {
    action: "create",
    collection: IMPORTED,
    rkey: await key(value),
    value,
  };
}

function room(job: Job): number {
  let bytes = 0;
  let taken = 0;

  for (const one of job.parts.slice(0, BATCH)) {
    bytes += JSON.stringify(one).length + 128;
    if (bytes > BYTES * 0.85 && taken > 0) break;
    taken += 1;
  }
  return taken;
}

// How far along, from whichever side of the import still holds the work: the
// parts not uploaded before they are, and what the repo owes after.
function sent(job: Job): number {
  const left =
    job.receipt || job.parts.length > 0
      ? job.parts.reduce((sum, one) => sum + size(one), 0)
      : owed(pending);
  return Math.max(job.total - left, 0);
}

function size(one: Receipt): number {
  return one.entries?.length ?? 0;
}

// Parts into cards, one transaction each. The repo says what is left, so this
// resumes on a device that never saw the file.
async function sink(now: OAuthSession, job: Job, mine: number): Promise<void> {
  if (pending.length === 0 && !(await refresh(now))) return;

  if (pending.length === 0) {
    await clear(now.did);
    ticks(false);
    announce({ at: "done", total: job.total });
    return;
  }

  const held = holdings?.();
  if (!held) return;

  const total = Math.max(job.total, owed(pending));
  const done = total - owed(pending);

  if (Date.now() < job.dueAt) {
    announce({
      at: "running",
      done,
      total,
      due: job.dueAt,
      quiet: job.misses >= QUIET,
    });
    return;
  }

  const [one] = pending;
  if (!one) return;
  announce({ at: "running", done, total, due: 0, quiet: false });

  const writes = drain(one, index(held, recent.values()), stamp());
  let applied: Applied;
  try {
    applied = await applyWrites(now, writes);
  } catch (failure) {
    // A part another device drained first is gone, and its cards with it. That
    // is the delete doing its work, not a failure to report.
    const gone =
      named(failure) &&
      (await refresh(now)) &&
      !pending.some((other) => other.uri === one.uri);
    if (gone) return;
    await refused(job, mine, failure);
    return;
  }

  const wrote = landed(writes, applied.results);
  holding(pending.slice(1));
  for (const made of wrote) recent.set(made.uri, made);
  job.misses = 0;
  job.total = total;
  job.dueAt = Date.now() + spacing(applied.budget, cost(writes));
  if (!(await keep(job, mine))) return;

  report?.(wrote);

  if (stopping) {
    ticks(false);
    announce({ at: "stopped", done: total - owed(pending), total });
    return;
  }
  announce({
    at: "running",
    done: total - owed(pending),
    total,
    due: job.dueAt,
    quiet: false,
  });
}

// What the repo still holds of every import, which is the only thing that says
// how much is left. False where the read failed, which answers nothing.
async function refresh(now: OAuthSession): Promise<boolean> {
  try {
    const found = await list<Receipt>(now, IMPORTED);
    const left = found.filter((one) => size(one.value) > 0);
    const digests = new Set(left.map((one) => one.value.digest));

    planned = found
      .filter((one) => size(one.value) === 0 && digests.has(one.value.digest))
      .reduce((sum, one) => sum + (one.value.stacks ?? 0), 0);

    taken = new Set(found.map((one) => rkey(one.uri)));
    holding(left);
    return true;
  } catch {
    return false;
  }
}

// A refusal is an answer and says when to come back. Anything that isn't an
// answer at all is the network, which is worth waiting out; anything the PDS
// named is a verdict, which is not.
async function refused(job: Job, mine: number, failure: unknown) {
  const total = job.total;
  const done = sent(job);

  // A refusal is an answer and carries its own wait, so it is never the end of
  // an import however many of them arrive.
  if (failure instanceof Refused) {
    job.dueAt = Date.now() + failure.after;
    job.misses = 0;
    if (await keep(job, mine)) {
      announce({ at: "running", done, total, due: job.dueAt, quiet: false });
    }
    return;
  }

  if (named(failure)) {
    job.paused = true;
    if (await keep(job, mine)) {
      ticks(false);
      announce({ at: "failed", done, total, why: reason(failure) });
    }
    return;
  }

  job.misses += 1;
  job.dueAt = Date.now() + Math.min(TICK * job.misses, BACKOFF);

  if (await keep(job, mine)) {
    announce({
      at: "running",
      done,
      total,
      due: job.dueAt,
      quiet: job.misses >= QUIET,
    });
  }
}

// What the PDS says it will still take, or nothing to wait for where it reports
// no limit at all. Its figure is points against whichever bucket is tightest,
// so a batch that fits inside what is left needs no pause before it.
function spacing(budget: Budget, cost: number): number {
  if (!budget) return 0;
  return budget.remaining > cost ? 0 : Math.max(budget.reset - Date.now(), 0);
}

function cost(writes: Write[]): number {
  return writes.reduce((sum, one) => sum + POINTS[one.action], 0);
}

function named(failure: unknown): boolean {
  return failure instanceof Verdict;
}

function reason(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function stamp(): string {
  return new Date().toISOString();
}

// Adopts whatever the last visit left and carries on with it, so an import
// resumes because the app opened rather than because a page was found.
export async function attach(
  now: OAuthSession | null,
  stacks: () => Stack[] | null,
  onWritten?: (written: Stack[]) => void,
): Promise<void> {
  session = now;
  holdings = stacks;
  report = onWritten ?? null;
  if (!now) {
    holding([]);
    recent = new Map();
    ticks(false);
    announce({ at: "none" });
    return;
  }

  // Anything not still waiting to be uploaded is in the repo, so that is what
  // says how much is left — including for an import this device never saw.
  const stored = await load(now.did);
  if (!stored?.receipt && !stored?.parts.length && !(await refresh(now))) {
    return;
  }

  const job = stored ?? found(now.did);
  if (!job) return;
  if (!stored) await save(job);

  // A job outliving its parts is one that finished somewhere else.
  if (!job.receipt && job.parts.length === 0 && pending.length === 0) {
    await clear(now.did);
    announce({ at: "done", total: job.total });
    return;
  }

  until = job.dueAt;
  announce(resumed(job));
  if (job.paused) return;
  ticks(true);
  void tick();
}

function found(did: string): Job | null {
  if (pending.length === 0) return null;
  return {
    did,
    receipt: null,
    parts: [],
    total: Math.max(planned, owed(pending)),
    dueAt: 0,
    misses: 0,
    paused: false,
  };
}

function resumed(job: Job): State {
  const done = sent(job);
  if (job.paused) return { at: "stopped", done, total: job.total };
  if (job.receipt || job.parts.length > 0) {
    return { at: "uploading", done, total: job.total };
  }
  return {
    at: "running",
    done,
    total: job.total,
    due: job.dueAt,
    quiet: job.misses >= QUIET,
  };
}

export async function begin(
  stacks: Parameters<typeof pack>[0],
  receipt: Receipt,
): Promise<void> {
  if (!session || stacks.length === 0) return;
  stopping = false;
  holding([]);

  const job: Job = {
    did: session.did,
    receipt,
    parts: pack(stacks, receipt),
    total: stacks.length,
    dueAt: 0,
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
      total: job.total,
      why: reason(failure),
    });
    return;
  }

  announce({ at: "uploading", done: 0, total: job.total });
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
    done: sent(job),
    total: job.total,
    due: job.dueAt,
    quiet: false,
  });
  ticks(true);
  void tick();
}

export async function halt(): Promise<void> {
  stopping = true;
  ticks(false);
  if (state.at === "running" || state.at === "uploading") {
    announce({ at: "stopped", done: state.done, total: state.total });
  }

  // A call already out records the stop itself, along with whatever it landed.
  if (stepping || !session) return;

  const job = await load(session.did);
  if (!job) return;

  job.paused = true;
  await save(job);
}

// Gives up the import, and the parts with it: left in the repo they would
// carry on filling the collection from a file nobody wants any more.
export async function drop(): Promise<void> {
  era += 1;
  stopping = false;
  ticks(false);
  const now = session;
  if (!now) {
    announce({ at: "none" });
    return;
  }

  // The parts go before the job does: one cleared while any of them stand is
  // one the next app open finds and builds a fresh import out of, writing the
  // cards from a file that was just discarded. A delete of a part another
  // device drained already succeeds, so nothing but a refusal stops here.
  await queued(async () => {
    const left = pending;
    const owed = left.length;
    try {
      for (const one of left) {
        await remove(now, IMPORTED, rkey(one.uri));
        holding(pending.filter((other) => other.uri !== one.uri));
      }
    } catch (failure) {
      announce({
        at: "failed",
        done: owed - pending.length,
        total: owed,
        why: reason(failure),
      });
      return;
    }

    await clear(now.did);
    holding([]);
    recent = new Map();
    announce({ at: "none" });
  });
}

function listen(watcher: () => void): () => void {
  watching.add(watcher);
  return () => void watching.delete(watcher);
}

// Copies dropped from a stack an import has not written yet, read and written
// inside the lock so a drain never lands between the two.
export async function shed(key: string, copies: number): Promise<boolean> {
  const now = session;
  if (!now || copies < 1) return false;

  let dropped = false;
  await queued(async () => {
    if (!(await refresh(now))) return;

    const { writes, left } = without(pending, key, copies);
    if (writes.length === 0) return;

    try {
      await applyWrites(now, writes);
      holding(left);
      dropped = true;
    } catch {
      await refresh(now);
    }
  });

  return dropped;
}

export function useImport(): State {
  return useSyncExternalStore(listen, () => state);
}

// Cards the repo holds inside an import rather than as records of their own.
export function useWaiting(): Owned[] {
  return useSyncExternalStore(listen, () => waiting);
}
