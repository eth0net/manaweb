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
