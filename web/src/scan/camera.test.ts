import { describe, expect, test } from "bun:test";
import { LONGEST, sized } from "./camera";

describe("what size a frame is read at", () => {
  test("leaves a frame already small enough alone", () => {
    expect(sized(640, 480)).toEqual({ width: 640, height: 480 });
  });

  test("scales the longer side down to the cap", () => {
    expect(sized(3840, 2160)).toEqual({ width: LONGEST, height: 720 });
  });

  // A phone held upright hands over the taller side first, and scaling only
  // the width would hand the art boxes a stretched card.
  test("scales a portrait frame by its own longer side", () => {
    expect(sized(2160, 3840)).toEqual({ width: 720, height: LONGEST });
  });

  test("keeps the shape it was given", () => {
    const { width, height } = sized(4000, 3000);
    expect(width / height).toBeCloseTo(4 / 3, 5);
  });

  // A video element reports zero until it has a frame, and a canvas of no
  // size throws rather than answering.
  test("has nothing to say about a frame with no pixels", () => {
    expect(sized(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
