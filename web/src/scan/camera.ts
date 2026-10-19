// The camera, and one frame taken out of it. Apart from the view, so what
// size a frame is read at is a function rather than a side effect.

import type { Picture } from "./read";

// The longest side a frame is read at. Detection samples further down than
// this for itself and a card is read back shorter again, so past here the
// pixels cost a scan time and reach nothing — `docs/scanner.md`.
export const LONGEST = 1280;

// The back camera, because a card is being pointed at rather than held up to
// a laptop. A device with one camera gives it whatever this says.
//
// One side only: asking both is asking for a square, and an iPhone obliges
// with one — `docs/scanner.md`.
const WANTED: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: LONGEST },
  },
};

export function sized(
  width: number,
  height: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= LONGEST || longest === 0) return { width, height };
  const by = LONGEST / longest;
  return {
    width: Math.max(1, Math.round(width * by)),
    height: Math.max(1, Math.round(height * by)),
  };
}

// A camera, or a reason there is none worth putting in front of someone.
export async function open(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    // A page has no camera at all unless it is a secure context, and the LAN
    // address a phone reaches a dev server on is not one. That is the usual
    // reason rather than a browser without the API, so it is said first.
    throw new Error(
      window.isSecureContext
        ? "This browser has no camera to open"
        : `A camera needs HTTPS, and this page is ${location.protocol}//. ` +
            "localhost is the exception, so a forwarded port works where a LAN address does not",
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia(WANTED);
  } catch (failed: unknown) {
    throw new Error(why(failed));
  }
}

function why(failed: unknown): string {
  const name = failed instanceof Error ? failed.name : "";
  if (name === "NotAllowedError") {
    return "The camera was refused. Allow it for this site and try again";
  }
  if (name === "NotFoundError") return "No camera on this device";
  if (name === "NotReadableError") {
    return "Something else is using the camera";
  }
  // An insecure context reaches here as a plain security error rather than
  // as one of the names above.
  return failed instanceof Error
    ? failed.message
    : "The camera would not open";
}

// The two halves a grab is spent in. Taken apart because they are two
// different machines: one is the GPU scaling a video frame, the other is
// reading it back across the bus — `docs/scanner.md`.
export type Half = "draw" | "readback";
export type Grab = (half: Half, ms: number) => void;

// One frame, or null before the video has any. `onto` is reused between
// scans: a canvas an allocation apart is a garbage collection mid-scan.
export function frame(
  from: HTMLVideoElement,
  onto: HTMLCanvasElement,
  clock?: Grab,
): Picture | null {
  const { videoWidth, videoHeight } = from;
  if (videoWidth === 0 || videoHeight === 0) return null;

  const { width, height } = sized(videoWidth, videoHeight);
  // Either assignment reallocates the backing store and clears it, whatever
  // it was set to, so a camera whose size has not moved is left alone.
  if (onto.width !== width) onto.width = width;
  if (onto.height !== height) onto.height = height;

  const paper = onto.getContext("2d", { willReadFrequently: true });
  if (!paper) return null;

  const began = performance.now();
  paper.drawImage(from, 0, 0, width, height);
  const drawn = performance.now();
  clock?.("draw", drawn - began);
  const picture = paper.getImageData(0, 0, width, height);
  clock?.("readback", performance.now() - drawn);
  return picture;
}
