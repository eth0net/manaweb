// The camera, and one frame taken out of it. Apart from the view, so what
// size a frame is read at is a function rather than a side effect.

import type { Picture } from "./read";

// The longest side a frame is read at. Detection samples further down than
// this for itself and a card is read back shorter again, so past here the
// pixels cost a scan time and reach nothing — `docs/scanner.md`.
export const LONGEST = 1280;

// The back camera, because a card is being pointed at rather than held up to
// a laptop. A device with one camera gives it whatever this says.
const WANTED: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: LONGEST },
    height: { ideal: LONGEST },
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

// One frame, or null before the video has any. `onto` is reused between
// scans: a canvas an allocation apart is a garbage collection mid-scan.
export function frame(
  from: HTMLVideoElement,
  onto: HTMLCanvasElement,
): Picture | null {
  const { videoWidth, videoHeight } = from;
  if (videoWidth === 0 || videoHeight === 0) return null;

  const { width, height } = sized(videoWidth, videoHeight);
  onto.width = width;
  onto.height = height;

  const paper = onto.getContext("2d", { willReadFrequently: true });
  if (!paper) return null;
  paper.drawImage(from, 0, 0, width, height);
  return paper.getImageData(0, 0, width, height);
}
