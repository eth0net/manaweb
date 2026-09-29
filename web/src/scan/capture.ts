// A frame and what the scanner made of it, posted back to the dev server so
// the corpus can hold a read that went wrong — `docs/scanner.md`.

// Where the dev server listens. Read by the middleware that serves it and by
// the check that the built app carries no trace of it.
export const CAPTURE = "/debug/capture";

export async function send(
  frame: HTMLCanvasElement,
  note: Record<string, unknown>,
): Promise<void> {
  const png = await encoded(frame);
  const answered = await fetch(CAPTURE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note, png }),
  });
  if (!answered.ok) {
    throw new Error(`The capture was refused: ${answered.status}`);
  }
}

// Base64, so one request carries the frame and the note together. A reader
// encodes it without script walking a megabyte of array.
function encoded(frame: HTMLCanvasElement): Promise<string> {
  return new Promise((keep, refuse) => {
    frame.toBlob((blob) => {
      if (!blob) {
        refuse(new Error("The frame would not encode"));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => refuse(new Error("The frame would not encode"));
      reader.onload = () => {
        const read = String(reader.result);
        keep(read.slice(read.indexOf(",") + 1));
      };
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}
