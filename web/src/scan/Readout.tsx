// The readout, laid over the viewfinder like everything else in the tab.
// Reached only from a branch the build drops — see [`bench.ts`].

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Catalog, Manifest } from "../catalog";
import {
  energy,
  type Kept,
  MEASURING,
  type Settled,
  type Sharpest,
  send,
  settled,
  summarize,
  type Tally,
  type Timing,
  timed,
} from "./bench";
import { frame, type Grab } from "./camera";
import { engine, index } from "./load";
import { type Picture, type Read, read } from "./read";

// Bytes a canvas gives per pixel.
const RGBA = 4;

// Frames a sharpest-of picks between. Enough to straddle a shake at thirty a
// second without the wait reading as a freeze.
const SHOTS = 5;

// How often the running tally reaches React. Every frame would put a render
// inside the thing being measured.
const EVERY = 10;

export function Readout({
  video,
  catalog,
  manifest,
}: {
  video: RefObject<HTMLVideoElement | null>;
  catalog: Catalog;
  manifest: Manifest;
}) {
  const paper = useRef<HTMLCanvasElement | null>(null);
  const run = useRef(0);
  // What the numbers were measured against, which is what makes two runs
  // comparable.
  const about = useRef<Kept["index"]>(null);
  const [one, setOne] = useState<Timing | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [running, setRunning] = useState(false);
  const [sharp, setSharp] = useState<Sharpest | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const [camera, setCamera] = useState<Settled | null>(null);

  // Read where the panel opens rather than per frame: a track settles once
  // and `getSettings` is a question for the camera, not for the loop.
  useEffect(() => setCamera(settled(video.current)), [video]);

  const take = useCallback(
    (clock?: Grab): Picture | null => {
      if (!video.current) return null;
      paper.current ??= document.createElement("canvas");
      return frame(video.current, paper.current, clock);
    },
    [video],
  );

  const ready = useCallback(async () => {
    const [held, artworks] = await Promise.all([engine(), index(manifest)]);
    if (!artworks) throw new Error("No artwork index to scan against");
    about.current = {
      version: artworks.version,
      rows: artworks.rows,
      hashes: artworks.hashes,
    };
    return { held, artworks };
  }, [manifest]);

  const stop = useCallback(() => {
    run.current += 1;
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const once = useCallback(() => {
    stop();
    setProblem(null);
    setKept(false);
    ready()
      .then(({ held, artworks }) => {
        const got = timed(held, catalog, artworks, take);
        setOne(got?.timing ?? null);
        if (!got) setProblem("The camera has not given a frame yet");
      })
      .catch((failed: unknown) => setProblem(said(failed)));
  }, [catalog, ready, stop, take]);

  const loop = useCallback(() => {
    run.current += 1;
    const mine = run.current;
    setRunning(true);
    setProblem(null);
    setKept(false);
    ready()
      .then(({ held, artworks }) => {
        const frames: Timing[] = [];
        const began = performance.now();
        const tick = () => {
          if (run.current !== mine) return;
          const got = timed(held, catalog, artworks, take);
          if (got) frames.push(got.timing);
          if (frames.length % EVERY === 0) {
            setTally(summarize(frames, performance.now() - began));
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
      .catch((failed: unknown) => {
        setRunning(false);
        setProblem(said(failed));
      });
  }, [catalog, ready, take]);

  // Frames are taken one camera frame apart rather than as fast as they can
  // be: two grabs inside one would score the same picture twice.
  const pick = useCallback(() => {
    stop();
    setProblem(null);
    setKept(false);
    ready()
      .then(async ({ held, artworks }) => {
        const mine = run.current;
        const shots: { picture: Picture; energy: number }[] = [];
        for (let at = 0; at < SHOTS; at++) {
          await waited(video.current);
          if (run.current !== mine) return;
          const picture = take();
          if (!picture) continue;
          const levels = held.luma(
            new Uint8Array(
              picture.data.buffer,
              picture.data.byteOffset,
              picture.data.byteLength,
            ),
            RGBA,
          );
          shots.push({
            picture,
            energy: energy(levels, picture.width, picture.height),
          });
        }

        const first = shots[0];
        if (!first) {
          setProblem("The camera gave no frames");
          return;
        }
        const best = shots.reduce((most, one) =>
          one.energy > most.energy ? one : most,
        );
        setSharp({
          energies: shots.map((shot) => shot.energy),
          which: shots.indexOf(best),
          first: read(held, catalog, artworks, first.picture),
          best: read(held, catalog, artworks, best.picture),
        });
      })
      .catch((failed: unknown) => setProblem(said(failed)));
  }, [catalog, ready, stop, take, video]);

  const put = useCallback(() => {
    send({ index: about.current, camera, one, run: tally, sharpest: sharp })
      .then(() => setKept(true))
      .catch((failed: unknown) => setProblem(said(failed)));
  }, [camera, one, sharp, tally]);

  return (
    <div className="scan-said solid">
      <p className="tally">{MEASURING}</p>
      {problem && <p className="warn">{problem}</p>}

      {camera && (
        <p className="tally">
          <small>
            camera {camera.width ?? "?"}x{camera.height ?? "?"} ·{" "}
            {camera.rate === null ? "?" : camera.rate.toFixed(0)}/s ·{" "}
            {camera.facing ?? "unsaid"}
            <br />
            shown {camera.shown?.width ?? "?"}x{camera.shown?.height ?? "?"} ·
            frame {camera.frame?.width ?? "?"}x{camera.frame?.height ?? "?"}
          </small>
        </p>
      )}

      {one && (
        <p className="tally">
          frame {ms(one.frame)} · luma {ms(one.luma)} · query {ms(one.query)} ·
          retrieve {ms(one.retrieve)} · <strong>total {ms(one.total)}</strong>
          <br />
          <small>
            the grab: draw {ms(one.draw)} · readback {ms(one.readback)}
          </small>
          <br />
          <small>
            {one.detected ? "card found" : "framings guessed at"}, margin{" "}
            {one.margin}
          </small>
        </p>
      )}

      {tally && (
        <p className="tally">
          {tally.frames} frames · {tally.fps.toFixed(1)}/s · {tally.detected}{" "}
          found
          <br />
          total p50 {ms(tally.total.p50)} · p90 {ms(tally.total.p90)} · worst{" "}
          {ms(tally.total.worst)}
          <br />
          <small>
            medians: frame {ms(tally.stages.frame)} · luma{" "}
            {ms(tally.stages.luma)} · query {ms(tally.stages.query)} · retrieve{" "}
            {ms(tally.stages.retrieve)}
          </small>
          <br />
          <small>
            the grab: draw {ms(tally.stages.draw)} · readback{" "}
            {ms(tally.stages.readback)}
          </small>
          <br />
          <small>
            found {tally.found === null ? "—" : ms(tally.found)} · guessed{" "}
            {tally.guessed === null ? "—" : ms(tally.guessed)}
          </small>
        </p>
      )}

      {sharp && (
        <p className="tally">
          sharpest of {sharp.energies.length}: #{sharp.which + 1} ·{" "}
          {sharp.energies.map((one) => one.toFixed(1)).join(" ")}
          <br />
          <small>
            first {margin(sharp.first)} · sharpest {margin(sharp.best)}
          </small>
        </p>
      )}

      <div className="scan-controls">
        <button type="button" onClick={once} disabled={running}>
          Read one
        </button>
        <button type="button" onClick={running ? stop : loop}>
          {running ? "Stop" : "Run"}
        </button>
        <button type="button" onClick={pick} disabled={running}>
          Sharpest
        </button>
        <button
          type="button"
          onClick={put}
          disabled={running || !(one || tally || sharp)}
        >
          {kept ? "Kept" : "Keep"}
        </button>
      </div>
    </div>
  );
}

function ms(of: number): string {
  return `${of.toFixed(1)}ms`;
}

function margin(of: Read | null): string {
  if (!of) return "nothing";
  return `margin ${of.margin}${of.quad ? "" : ", guessed"}`;
}

// One camera frame, where the browser will say when one arrives and a paint
// otherwise. iOS has had `requestVideoFrameCallback` since 15.4; the
// fallback is for whatever has not.
function waited(video: HTMLVideoElement | null): Promise<void> {
  const held = video as
    | (HTMLVideoElement & {
        requestVideoFrameCallback?: (run: () => void) => number;
      })
    | null;
  return new Promise((keep) => {
    if (held?.requestVideoFrameCallback) {
      held.requestVideoFrameCallback(() => keep());
    } else {
      requestAnimationFrame(() => keep());
    }
  });
}

function said(failed: unknown): string {
  return failed instanceof Error ? failed.message : String(failed);
}
