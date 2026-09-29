import { useCallback, useEffect, useRef, useState } from "react";
import { CardRow } from "../CardRow";
import type { Catalog, Manifest } from "../catalog";
import { frame, open } from "./camera";
import { engine, index } from "./load";
import { type Read, read } from "./read";

export const SCAN = "/scan";

type Answer =
  | { at: "none" }
  | { at: "reading" }
  | { at: "nothing" }
  | { at: "found"; held: Read };

// A card read out of the camera. What it finds does not land anywhere yet —
// see `docs/scanner.md`.
export function Scan({
  catalog,
  manifest,
}: {
  catalog: Catalog | null;
  manifest: Manifest | null;
}) {
  const [camera, setCamera] = useState<"off" | "opening" | "on">("off");
  const [answer, setAnswer] = useState<Answer>({ at: "none" });
  const [problem, setProblem] = useState<string | null>(null);

  const video = useRef<HTMLVideoElement>(null);
  const paper = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);

  // A camera left running is a light left on, so it goes out with the page as
  // well as with the button.
  const stop = useCallback(() => {
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera("off");
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setCamera("opening");
    setProblem(null);
    try {
      // Both before the camera opens, so the wait is one rather than two and
      // the first scan is not the one that pays for the index.
      if (manifest) await Promise.all([engine(), index(manifest)]);
      const held = await open();
      stream.current = held;
      if (video.current) {
        video.current.srcObject = held;
        await video.current.play();
      }
      setCamera("on");
    } catch (failed: unknown) {
      stop();
      setProblem(said(failed));
    }
  }, [manifest, stop]);

  const take = useCallback(async () => {
    if (!catalog || !manifest || !video.current) return;
    setAnswer({ at: "reading" });
    setProblem(null);
    try {
      paper.current ??= document.createElement("canvas");
      const picture = frame(video.current, paper.current);
      const [held, artworks] = await Promise.all([engine(), index(manifest)]);
      if (!picture || !artworks) {
        setAnswer({ at: "none" });
        setProblem("No artwork index to scan against");
        return;
      }
      const found = read(held, catalog, artworks, picture);
      setAnswer(found ? { at: "found", held: found } : { at: "nothing" });
    } catch (failed: unknown) {
      setAnswer({ at: "none" });
      setProblem(said(failed));
    }
  }, [catalog, manifest]);

  if (!catalog || !manifest) {
    return <p className="quiet">The catalog is still loading.</p>;
  }
  if (!manifest.artwork) {
    return (
      <p className="quiet">
        This catalog was published without an artwork index, so there is
        nothing to scan against.
      </p>
    );
  }

  return (
    <div className="column">
      {/* Hidden rather than unmounted: the ref has to outlive a read. */}
      <video ref={video} playsInline muted hidden={camera !== "on"} />

      {camera === "off" && (
        <button type="button" onClick={() => void start()}>
          Open the camera
        </button>
      )}
      {camera === "opening" && <p>Opening the camera…</p>}
      {camera === "on" && (
        <>
          <button
            type="button"
            onClick={() => void take()}
            disabled={answer.at === "reading"}
          >
            {answer.at === "reading"
              ? "Reading…"
              : answer.at === "none"
                ? "Scan the card"
                : "Scan another"}
          </button>
          <button type="button" onClick={stop}>
            Close the camera
          </button>
        </>
      )}

      {problem && <p className="warn">{problem}</p>}
      {answer.at === "nothing" && (
        <p className="warn">Nothing in that frame looked like a card.</p>
      )}
      {answer.at === "found" && (
        <Answered found={answer.held} catalog={catalog} />
      )}
    </div>
  );
}

// What came back, and how much to believe it. The runners-up show only where
// the margin is too thin to take, which is the whole of what it is for.
function Answered({ found, catalog }: { found: Read; catalog: Catalog }) {
  const first = found.prints[0];

  return (
    <div className="column">
      <p className={found.sure ? "tally" : "warn"}>
        {found.sure
          ? "This is the card."
          : "This is the nearest, but another was almost as close."}
        {!found.detected &&
          " No card was found in the frame, so it was read as if one filled it."}
      </p>

      {first ? (
        <CardRow card={first.card} print={first.print} catalog={catalog} />
      ) : (
        <p className="quiet">No printing in this catalog carries that art.</p>
      )}

      {!found.sure && found.matches.length > 1 && (
        <>
          <p className="quiet">Or one of these:</p>
          {found.matches.slice(1).map((held) => (
            <Other key={held.artwork} at={held.artwork} catalog={catalog} />
          ))}
        </>
      )}
    </div>
  );
}

function Other({ at, catalog }: { at: number; catalog: Catalog }) {
  const held = catalog.artwork(at)[0];
  if (!held) return null;
  return <CardRow card={held.card} print={held.print} catalog={catalog} />;
}

function said(failed: unknown): string {
  return failed instanceof Error ? failed.message : String(failed);
}
