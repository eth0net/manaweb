// Where a card's corners land on the viewfinder. The engine answers in the
// picture's own pixels and the video is shown `object-fit: cover`, so the
// overlay repeats the scale and the crop the browser is doing.

import type { Point, Quad } from "./engine";

export interface Box {
  width: number;
  height: number;
}

// Null where either side has no size to scale against, which is every frame
// before the camera has given one.
export function placed(quad: Quad, from: Box, onto: Box): Quad | null {
  if (from.width <= 0 || from.height <= 0) return null;
  if (onto.width <= 0 || onto.height <= 0) return null;

  // Cover fills the box and spills over the other way, so both sides take
  // the larger ratio and the spill is halved off each edge. A corner the
  // crop cuts comes back outside the box rather than clamped to it.
  const by = Math.max(onto.width / from.width, onto.height / from.height);
  const left = (onto.width - from.width * by) / 2;
  const top = (onto.height - from.height * by) / 2;
  const at = ({ x, y }: Point): Point => ({
    x: left + x * by,
    y: top + y * by,
  });

  return [at(quad[0]), at(quad[1]), at(quad[2]), at(quad[3])];
}

// Whether any of it shows, by bounding box rather than by corner — see
// `docs/scanner.md` for which way that has to be wrong.
export function within(quad: Quad, onto: Box): boolean {
  const xs = quad.map(({ x }) => x);
  const ys = quad.map(({ y }) => y);
  return (
    Math.max(...xs) >= 0 &&
    Math.min(...xs) <= onto.width &&
    Math.max(...ys) >= 0 &&
    Math.min(...ys) <= onto.height
  );
}

// How far a corner travels toward where it was last seen, per pass.
const EASE = 0.35;

// The engine names corners from one of the card's short sides, and which of
// the two it picks can differ between frames. Easing across that swap swings
// the box, so the turn nearest the last reading is the one to ease toward.
export function aligned(was: Quad, now: Quad): Quad {
  let best = now;
  let least = Number.POSITIVE_INFINITY;
  for (let turn = 0; turn < 4; turn++) {
    const spun = spin(now, turn);
    const moved = spun.reduce(
      (sum, point, at) => sum + apart(point, corner(was, at)),
      0,
    );
    if (moved < least) {
      least = moved;
      best = spun;
    }
  }
  return best;
}

// Partway from where the box was to where the card is. A corner that moved
// further than `far` is the card itself moving rather than the detector
// wandering, so that one is followed rather than eased.
export function eased(was: Quad, now: Quad, far: number): Quad {
  const turned = aligned(was, now);
  if (turned.some((point, at) => apart(point, corner(was, at)) > far)) {
    return turned;
  }
  return spin(
    turned.map((point, at) => {
      const from = corner(was, at);
      return {
        x: from.x + (point.x - from.x) * EASE,
        y: from.y + (point.y - from.y) * EASE,
      };
    }) as Quad,
    0,
  );
}

function spin(quad: Quad, by: number): Quad {
  const at = (which: number) => corner(quad, which + by);
  return [at(0), at(1), at(2), at(3)];
}

function corner(quad: Quad, at: number): Point {
  return quad[at % 4] as Point;
}

function apart(one: Point, two: Point): number {
  return Math.hypot(one.x - two.x, one.y - two.y);
}
