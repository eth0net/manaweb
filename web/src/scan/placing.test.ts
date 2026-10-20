import { describe, expect, test } from "bun:test";
import type { Quad } from "./engine";
import { aligned, eased, placed, within } from "./placing";

// The corners of the picture itself, so what comes back says where the
// picture's own edges went.
function edges(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

const PICTURE = { width: 720, height: 1280 };

describe("where a card's corners land on the viewfinder", () => {
  test("scales and leaves nothing over where the shapes agree", () => {
    const got = placed(edges(720, 1280), PICTURE, { width: 360, height: 640 });
    expect(got).toEqual([
      { x: 0, y: 0 },
      { x: 360, y: 0 },
      { x: 360, y: 640 },
      { x: 0, y: 640 },
    ]);
  });

  // A box wider than the picture fills on width, so the picture's top and
  // bottom are the parts cover takes away.
  test("cuts the top and bottom off a picture taller than its box", () => {
    const got = placed(edges(720, 1280), PICTURE, { width: 720, height: 640 });
    expect(got?.[0]).toEqual({ x: 0, y: -320 });
    expect(got?.[2]).toEqual({ x: 720, y: 960 });
  });

  test("cuts the sides off a picture wider than its box", () => {
    const got = placed(edges(720, 1280), PICTURE, {
      width: 360,
      height: 1280,
    });
    expect(got?.[0]).toEqual({ x: -180, y: 0 });
    expect(got?.[2]).toEqual({ x: 540, y: 1280 });
  });

  // Outside the box rather than clamped to its edge.
  test("answers outside the box for a corner the crop took", () => {
    const onto = { width: 720, height: 640 };
    const got = placed(edges(720, 1280), PICTURE, onto);
    expect(got?.[0].y).toBeLessThan(0);
  });

  // Every corner of this one is off the screen and all of the screen is
  // inside it, which is what a card held close looks like.
  test("counts a card larger than the viewfinder as showing", () => {
    const onto = { width: 720, height: 640 };
    expect(within(placed(edges(720, 1280), PICTURE, onto) as Quad, onto)).toBe(
      true,
    );
  });

  test("says when none of it is on the screen", () => {
    const onto = { width: 720, height: 640 };
    const away: Quad = [
      { x: 0, y: 2000 },
      { x: 10, y: 2000 },
      { x: 10, y: 2010 },
      { x: 0, y: 2010 },
    ];
    expect(within(placed(away, PICTURE, onto) as Quad, onto)).toBe(false);
  });

  test("has nothing to place before the camera has given a frame", () => {
    expect(placed(edges(1, 1), { width: 0, height: 0 }, PICTURE)).toBeNull();
    expect(placed(edges(1, 1), PICTURE, { width: 0, height: 0 })).toBeNull();
  });
});

describe("holding a box still while the card is", () => {
  const box: Quad = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ];

  // The same four corners named from the other short side, which is what a
  // detector hands back every so often over a card nobody has moved.
  const turned: Quad = [box[2], box[3], box[0], box[1]];

  test("reads a turned quad as the same corners", () => {
    expect(aligned(box, turned)).toEqual(box);
  });

  test("eases toward a corner that barely moved", () => {
    const crept: Quad = box.map(({ x, y }) => ({ x: x + 2, y })) as Quad;
    const got = eased(box, crept, 50);
    expect(got[0].x).toBeGreaterThan(0);
    expect(got[0].x).toBeLessThan(2);
  });

  // The whole of what the easing is for: the same pass damps a wander and
  // keeps up with a move, so the fraction has to rise with the distance.
  test("covers more of a longer move in one pass", () => {
    const near = eased(
      box,
      box.map(({ x, y }) => ({ x: x + 2, y })) as Quad,
      50,
    );
    const far = eased(
      box,
      box.map(({ x, y }) => ({ x: x + 20, y })) as Quad,
      50,
    );
    expect(near[0].x / 2).toBeLessThan(far[0].x / 20);
  });

  // Easing a real move would drag the box along behind the card.
  test("follows a corner that jumped", () => {
    const moved: Quad = box.map(({ x, y }) => ({ x: x + 80, y })) as Quad;
    expect(eased(box, moved, 50)).toEqual(moved);
  });

  test("settles where the card is if it stays there", () => {
    const crept: Quad = box.map(({ x, y }) => ({ x: x + 4, y })) as Quad;
    let at = box;
    for (let pass = 0; pass < 40; pass++) at = eased(at, crept, 50);
    expect(at[0].x).toBeCloseTo(4, 2);
  });
});
