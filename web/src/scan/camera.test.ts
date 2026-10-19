import { describe, expect, test } from "bun:test";
import { frame, LONGEST, sized } from "./camera";

describe("what size a frame is read at", () => {
  test("leaves a frame already small enough alone", () => {
    expect(sized(640, 480)).toEqual({ width: 640, height: 480 });
  });

  test("scales the longer side down to the cap", () => {
    expect(sized(3840, 2160)).toEqual({ width: LONGEST, height: 720 });
  });

  // A phone held upright hands over the taller side first.
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

// A canvas and a video as a browser answers them, which is all `frame`
// touches. No DOM here, so the shape is the contract.
function paper(): { onto: HTMLCanvasElement; sizings: number } {
  const held = {
    sizings: 0,
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => {},
      getImageData: (
        _x: number,
        _y: number,
        width: number,
        height: number,
      ) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
    }),
  };
  const onto = {
    getContext: held.getContext,
    get width() {
      return held.width;
    },
    set width(to: number) {
      held.sizings += 1;
      held.width = to;
    },
    get height() {
      return held.height;
    },
    set height(to: number) {
      held.sizings += 1;
      held.height = to;
    },
  };
  return {
    onto: onto as unknown as HTMLCanvasElement,
    get sizings() {
      return held.sizings;
    },
  };
}

function camera(width: number, height: number): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

describe("what a grab costs", () => {
  test("has nothing to grab before the video has a frame", () => {
    expect(frame(camera(0, 0), paper().onto)).toBeNull();
  });

  test("sizes the canvas once however many frames are taken", () => {
    const held = paper();
    const from = camera(1280, 720);
    for (let at = 0; at < 3; at++) frame(from, held.onto);
    expect(held.sizings).toBe(2);
  });

  test("sizes it again when the camera changes shape", () => {
    const held = paper();
    frame(camera(1280, 720), held.onto);
    frame(camera(720, 1280), held.onto);
    expect(held.sizings).toBe(4);
  });

  test("times the two halves apart", () => {
    const spent: string[] = [];
    frame(camera(640, 480), paper().onto, (half) => spent.push(half));
    expect(spent).toEqual(["draw", "readback"]);
  });
});
