// The card the camera can see, drawn over the viewfinder while it is being
// aimed. Corners only: a box wants where a card is and not what it is, and
// leaving out the hashing is what keeps it inside a frame.

import { type RefObject, useEffect, useRef } from "react";
import { frame } from "./camera";
import type { Engine, Quad } from "./engine";
import { engine } from "./load";
import { type Box, eased, placed, within } from "./placing";

// Bytes a canvas gives per pixel.
const RGBA = 4;

// A floor rather than a rate: the camera says when there is something new
// to look at, and this only stops a sixty-a-second one asking for sixty
// detections.
const SOONEST = 1000 / 40;

// Passes a box outlives the reading that drew it. Detection drops one here
// and there over a card nobody has touched, and clearing on the first of
// those reads as a flicker rather than as an answer.
const MISSES = 3;

// A corner further than an eighth of the frame from where it was is the card
// moving rather than the detector wandering.
const FAR = 8;

// What the last pass saw, kept so the next one can ease toward rather than
// jump to it.
interface Held {
  quad: Quad;
  missed: number;
}

export function Outline({
  video,
}: {
  video: RefObject<HTMLVideoElement | null>;
}) {
  const onto = useRef<HTMLCanvasElement>(null);
  const paper = useRef<HTMLCanvasElement | null>(null);
  const held = useRef<Held | null>(null);

  useEffect(() => {
    let live = true;
    let hashing: Engine | null = null;
    let last = 0;
    // A failure leaves the outline off rather than the tab broken: the scan
    // button asks for the same engine and reports what it says.
    engine().then(
      (got) => {
        hashing = got;
      },
      () => {},
    );

    // Woken by the camera where it will say: a frame arrives thirty times a
    // second and wants looking at once, where a paint clock reads some of
    // them twice and misses others. iOS has had it since 15.4.
    function again() {
      const on = video.current as
        | (HTMLVideoElement & {
            requestVideoFrameCallback?: (run: (now: number) => void) => number;
          })
        | null;
      if (on?.requestVideoFrameCallback) on.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
    }

    function tick(now: number) {
      if (!live) return;
      again();
      if (now - last < SOONEST) return;
      last = now;
      try {
        look(hashing, video.current, paper, onto.current, held);
      } catch {
        // The engine refuses a frame it has no room for, and the loop is
        // already armed for the next one, so this would throw every frame
        // for as long as the camera was open. An outline is what a capable
        // device gets on top: it stops, and scanning still says what is
        // wrong when somebody presses it.
        live = false;
        held.current = null;
        clear(onto.current);
      }
    }

    again();

    return () => {
      live = false;
    };
  }, [video]);

  return <canvas ref={onto} className="scan-outline" />;
}

function look(
  hashing: Engine | null,
  from: HTMLVideoElement | null,
  paper: RefObject<HTMLCanvasElement | null>,
  onto: HTMLCanvasElement | null,
  held: RefObject<Held | null>,
): void {
  if (!onto) return;
  const ink = ready(onto);
  if (!ink) return;
  ink.clearRect(0, 0, onto.width, onto.height);
  if (!hashing || !from) return;

  paper.current ??= document.createElement("canvas");
  const picture = frame(from, paper.current);
  if (!picture) return;

  const levels = hashing.luma(
    new Uint8Array(
      picture.data.buffer,
      picture.data.byteOffset,
      picture.data.byteLength,
    ),
    RGBA,
  );
  const quad = hashing.detect(levels, picture.width, picture.height);
  const was = held.current;
  if (quad) {
    held.current = {
      quad: was ? eased(was.quad, quad, picture.width / FAR) : quad,
      missed: 0,
    };
  } else if (was && was.missed < MISSES) {
    held.current = { quad: was.quad, missed: was.missed + 1 };
  } else {
    held.current = null;
  }

  const show = held.current?.quad;
  if (!show) return;
  const box: Box = { width: onto.width, height: onto.height };
  const at = placed(show, picture, box);
  if (at && within(at, box)) draw(ink, at, onto.width);
}

function clear(onto: HTMLCanvasElement | null): void {
  if (!onto) return;
  onto.getContext("2d")?.clearRect(0, 0, onto.width, onto.height);
}

// The backing store in device pixels, so a hairline stays one on a phone.
function ready(onto: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const by = window.devicePixelRatio || 1;
  const width = Math.round(onto.clientWidth * by);
  const height = Math.round(onto.clientHeight * by);
  if (width === 0 || height === 0) return null;
  if (onto.width !== width) onto.width = width;
  if (onto.height !== height) onto.height = height;
  return onto.getContext("2d");
}

// Twice over, because what is behind it is a photograph: a pale line is
// lost against a white border and a dark one against the art, so the dark
// stroke underneath is what carries the other.
function draw(
  ink: CanvasRenderingContext2D,
  quad: Quad,
  across: number,
): void {
  const wide = Math.max(2, across / 220);
  ink.beginPath();
  for (const [at, { x, y }] of quad.entries()) {
    if (at === 0) ink.moveTo(x, y);
    else ink.lineTo(x, y);
  }
  ink.closePath();
  ink.lineJoin = "round";
  ink.strokeStyle = "rgb(0 0 0 / 55%)";
  ink.lineWidth = wide * 2.5;
  ink.stroke();
  ink.strokeStyle = "#f4f4f2";
  ink.lineWidth = wide;
  ink.stroke();
}
