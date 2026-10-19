// What a read costs, stage by stage, and what a run of them achieves. The
// frame budget in `docs/scanner.md` is a laptop figure, and this is the
// instrument that answers it on a phone.
//
// Development only. Nothing outside a branch the build drops imports this,
// and `bun run sealed` reads the build back for [`MEASURING`].

import type { Catalog } from "../catalog";
import type { Artworks } from "../catalog/artwork";
import type { Grab, Half } from "./camera";
import { CAPTURE } from "./capture";
import type { Engine } from "./engine";
import { type Picture, type Read, read, type Stage } from "./read";

// What the readout is headed, and the string the seal looks for. ASCII, so
// that a build read back as latin1 would still match it.
export const MEASURING = "Stage timings, development only";

// Milliseconds a frame spent, in the order they were spent. `frame` is the
// grab whole and `draw` and `readback` are its halves, so the three are not
// four stages to add up.
export interface Timing {
  frame: number;
  draw: number;
  readback: number;
  luma: number;
  query: number;
  retrieve: number;
  total: number;
  // A frame no card was found in is the more expensive of the two, and most
  // of a search is those.
  detected: boolean;
  margin: number;
  sure: boolean;
}

// Null where the camera had no frame to give.
export function timed(
  engine: Engine,
  catalog: Catalog,
  index: Artworks,
  take: (clock: Grab) => Picture | null,
): { timing: Timing; found: Read | null } | null {
  const halves: Record<Half, number> = { draw: 0, readback: 0 };
  const began = performance.now();
  const picture = take((half, ms) => {
    halves[half] = ms;
  });
  if (!picture) return null;
  const frame = performance.now() - began;

  const stages: Record<Stage, number> = { luma: 0, query: 0, retrieve: 0 };
  const found = read(engine, catalog, index, picture, (stage, ms) => {
    stages[stage] = ms;
  });

  return {
    found,
    timing: {
      frame,
      ...halves,
      ...stages,
      total: performance.now() - began,
      detected: found?.quad != null,
      margin: found?.margin ?? 0,
      sure: found?.sure ?? false,
    },
  };
}

export interface Tally {
  frames: number;
  // Reads a second over the whole run, not off the last frame.
  fps: number;
  detected: number;
  total: { p50: number; p90: number; worst: number };
  stages: Record<"frame" | Half | Stage, number>;
  // Medians of the two cases apart, which is the split the budget turns on.
  // Null where the run held none of that kind.
  found: number | null;
  guessed: number | null;
}

export function summarize(
  frames: readonly Timing[],
  elapsed: number,
): Tally | null {
  if (frames.length === 0) return null;
  const totals = frames.map((one) => one.total);
  const cut = (of: readonly Timing[]) =>
    of.length === 0
      ? null
      : quantile(
          of.map((one) => one.total),
          0.5,
        );

  return {
    frames: frames.length,
    fps: elapsed > 0 ? (frames.length * 1000) / elapsed : 0,
    detected: frames.filter((one) => one.detected).length,
    total: {
      p50: quantile(totals, 0.5),
      p90: quantile(totals, 0.9),
      worst: Math.max(...totals),
    },
    stages: {
      frame: quantile(
        frames.map((one) => one.frame),
        0.5,
      ),
      draw: quantile(
        frames.map((one) => one.draw),
        0.5,
      ),
      readback: quantile(
        frames.map((one) => one.readback),
        0.5,
      ),
      luma: quantile(
        frames.map((one) => one.luma),
        0.5,
      ),
      query: quantile(
        frames.map((one) => one.query),
        0.5,
      ),
      retrieve: quantile(
        frames.map((one) => one.retrieve),
        0.5,
      ),
    },
    found: cut(frames.filter((one) => one.detected)),
    guessed: cut(frames.filter((one) => !one.detected)),
  };
}

// Nearest rank, which wants no interpolating over the couple of hundred
// frames a run holds.
export function quantile(of: readonly number[], at: number): number {
  const sorted = [...of].sort((one, two) => one - two);
  const which = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(at * sorted.length) - 1),
  );
  return sorted[which] ?? 0;
}

// Mean absolute gradient over a sampled grid: the same scene carries less of
// it blurred than sharp, which is the whole of what picking a frame by it
// needs — `docs/scanner.md`.
export function energy(
  levels: Uint8Array,
  width: number,
  height: number,
  step = 2,
): number {
  let sum = 0;
  let count = 0;
  for (let y = step; y < height; y += step) {
    for (let x = step; x < width; x += step) {
      const here = levels[y * width + x] ?? 0;
      sum += Math.abs(here - (levels[y * width + x - step] ?? 0));
      sum += Math.abs(here - (levels[(y - step) * width + x] ?? 0));
      count += 2;
    }
  }
  return count === 0 ? 0 : sum / count;
}

// What the camera actually handed over, which the constraint only asked for.
// A frame larger than `LONGEST` is being scaled inside the draw, and that is
// a cost nothing else here would show.
export interface Settled {
  width: number | null;
  height: number | null;
  rate: number | null;
  facing: string | null;
}

export function settled(video: HTMLVideoElement | null): Settled | null {
  const stream = video?.srcObject;
  if (!(stream instanceof MediaStream)) return null;
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  const got = track.getSettings();
  return {
    width: got.width ?? null,
    height: got.height ?? null,
    rate: got.frameRate ?? null,
    facing: got.facingMode ?? null,
  };
}

// Which of a handful of frames carried the most detail, and what a read of
// the first and of that one each came back with.
export interface Sharpest {
  energies: number[];
  which: number;
  first: Read | null;
  best: Read | null;
}

// Everything the panel is showing, which is what a press keeps.
export interface Kept {
  index: { version: string; rows: number; hashes: number } | null;
  camera: Settled | null;
  one: Timing | null;
  run: Tally | null;
  sharpest: Sharpest | null;
}

// To the route a reported frame goes to, as a note with no picture: a phone
// reading these off its own screen is how they get copied wrong.
export async function send(held: Kept): Promise<void> {
  const answered = await fetch(CAPTURE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      note: {
        at: new Date().toISOString(),
        agent: navigator.userAgent,
        ...held,
      },
    }),
  });
  if (!answered.ok) {
    throw new Error(`The timings were refused: ${answered.status}`);
  }
}
