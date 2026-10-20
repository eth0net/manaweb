// The card the camera can see, drawn over the viewfinder while it is being
// aimed. Corners only: a box wants where a card is and not what it is, and
// leaving out the hashing is what keeps it inside a frame.

import { type RefObject, useEffect, useRef } from "react";
import { frame } from "./camera";
import type { Engine, Quad } from "./engine";
import { engine } from "./load";
import { type Box, placed, within } from "./placing";

// Bytes a canvas gives per pixel.
const RGBA = 4;

// How often it is redrawn. A camera gives thirty a second and an outline
// reads as smooth at fewer, so the ones it skips are frames nobody pays for.
const EVERY = 1000 / 20;

export function Outline({
  video,
}: {
  video: RefObject<HTMLVideoElement | null>;
}) {
  const onto = useRef<HTMLCanvasElement>(null);
  const paper = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let live = true;
    let held: Engine | null = null;
    let last = 0;
    // A failure leaves the outline off rather than the tab broken: the scan
    // button asks for the same engine and reports what it says.
    engine().then(
      (got) => {
        held = got;
      },
      () => {},
    );

    const tick = (now: number) => {
      if (!live) return;
      requestAnimationFrame(tick);
      if (now - last < EVERY) return;
      last = now;
      look(held, video.current, paper, onto.current);
    };
    requestAnimationFrame(tick);

    return () => {
      live = false;
    };
  }, [video]);

  return <canvas ref={onto} className="scan-outline" />;
}

function look(
  held: Engine | null,
  from: HTMLVideoElement | null,
  paper: RefObject<HTMLCanvasElement | null>,
  onto: HTMLCanvasElement | null,
): void {
  if (!onto) return;
  const ink = ready(onto);
  if (!ink) return;
  ink.clearRect(0, 0, onto.width, onto.height);
  if (!held || !from) return;

  paper.current ??= document.createElement("canvas");
  const picture = frame(from, paper.current);
  if (!picture) return;

  const levels = held.luma(
    new Uint8Array(
      picture.data.buffer,
      picture.data.byteOffset,
      picture.data.byteLength,
    ),
    RGBA,
  );
  const quad = held.detect(levels, picture.width, picture.height);
  if (!quad) return;

  const box: Box = { width: onto.width, height: onto.height };
  const at = placed(quad, picture, box);
  if (at && within(at, box)) draw(ink, at, onto.width);
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
