import { useCallback, useEffect, useRef, useState } from "react";
import {
  appLanguage,
  type Card,
  type Catalog,
  cardName,
  image,
  type Manifest,
  type Print,
} from "../catalog";
import { describe } from "../Printing";
import { frame, open } from "./camera";
import { engine, index } from "./load";
import { type Read, read } from "./read";

export const SCAN = "/scan";

const APP = appLanguage();

type Answer =
  | { at: "none" }
  | { at: "reading" }
  | { at: "nothing" }
  | { at: "found"; held: Read };

// The tab is the viewfinder, and what came back is laid over it rather than
// put above it: a run of scanning should not be a run of pages.
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
  // todo(settings): held for the page rather than the person, there being
  // nowhere yet for a preference to live — `docs/scanner.md`.
  const [solid, setSolid] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const paper = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  // Cleared by anything that gives up on a camera being opened, so that one
  // arriving afterwards is stopped rather than held by a component nobody is
  // looking at any more.
  const wanted = useRef(false);

  // A camera left running is a light left on, so it goes out with the page as
  // well as with the button.
  const stop = useCallback(() => {
    wanted.current = false;
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera("off");
    setAnswer({ at: "none" });
    setProblem(null);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    wanted.current = true;
    setCamera("opening");
    setProblem(null);
    try {
      // Both before the camera opens, so the wait is one rather than two and
      // the first scan is not the one that pays for the index.
      if (manifest) await Promise.all([engine(), index(manifest)]);
      const held = await open();
      // Opening a camera takes long enough to leave the page in, and the
      // cleanup that ran meanwhile had nothing to stop.
      if (!wanted.current) {
        for (const track of held.getTracks()) track.stop();
        return;
      }
      stream.current = held;
      if (video.current) {
        video.current.srcObject = held;
        await video.current.play();
      }
      if (!wanted.current) {
        stop();
        return;
      }
      setCamera("on");
    } catch (failed: unknown) {
      const why = said(failed);
      stop();
      setProblem(why);
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
      if (!picture) {
        setAnswer({ at: "none" });
        setProblem("The camera has not given a frame yet");
        return;
      }
      if (!artworks) {
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

  const answered =
    answer.at === "found" || answer.at === "nothing" || Boolean(problem);

  return (
    <div className="scan">
      {/* Mounted whatever the state: the ref has to outlive a read, and a
          video remade between scans loses the stream attached to it. */}
      <video ref={video} playsInline muted hidden={camera !== "on"} />

      {camera !== "on" && (
        <div className="scan-idle">
          {camera === "opening" ? (
            <>
              <p>Opening the camera…</p>
              <button type="button" onClick={stop}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void start()}>
              Open the camera
            </button>
          )}
          {problem && <p className="warn">{problem}</p>}
        </div>
      )}

      {camera === "on" && (
        <>
          {answered && (
            <div className={solid ? "scan-said solid" : "scan-said"}>
              <button
                type="button"
                className="scan-veil"
                onClick={() => setSolid(!solid)}
                aria-pressed={solid}
              >
                {solid ? "See through" : "Solid"}
              </button>
              {problem && <p className="warn">{problem}</p>}
              {answer.at === "nothing" && (
                <p>Nothing in that frame looked like a card.</p>
              )}
              {answer.at === "found" && <Answered found={answer.held} />}
            </div>
          )}

          <div className="scan-controls">
            <button
              type="button"
              onClick={() => void take()}
              disabled={answer.at === "reading"}
            >
              {answer.at === "reading"
                ? "Reading…"
                : answer.at === "none"
                  ? "Scan"
                  : "Scan again"}
            </button>
            <button type="button" onClick={stop}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// What came back, and how much to believe it. The runners-up show only where
// the margin is too thin to take, which is the whole of what keeping them is
// for.
function Answered({ found }: { found: Read }) {
  const [first, ...rest] = found.found;

  return (
    <>
      <p className={found.sure ? "tally" : "warn"}>
        {found.sure ? "This is the card." : "Nearest, but not by much."}
        {/* Both can be true at once: the framings guessed at when no outline
            was found still answered, and still answered clear of the floor.
            Said as a caveat rather than as a second verdict. */}
        {!found.detected &&
          " Its outline was not found, so the whole frame was read as the card."}
      </p>

      {first?.prints[0] ? (
        <Named card={first.prints[0].card} print={first.prints[0].print} />
      ) : (
        <p className="quiet">No printing in this catalog carries that art.</p>
      )}

      {!found.sure &&
        rest.map((held) =>
          held.prints[0] ? (
            <Named
              key={held.artwork}
              card={held.prints[0].card}
              print={held.prints[0].print}
              quiet
            />
          ) : null,
        )}
    </>
  );
}

// Enough of a printing to tell whether it is the card in your hand: the art
// as it was scanned, the name, and what tells two printings apart.
function Named({
  card,
  print,
  quiet = false,
}: {
  card: Card;
  print: Print;
  quiet?: boolean;
}) {
  const named = cardName(card.name, print, APP);

  return (
    <p className={quiet ? "scan-named quiet" : "scan-named"}>
      <img src={image(print.id, "small")} alt="" width="48" height="67" />
      <span>
        <span lang={named.lang}>{named.text}</span>
        <br />
        <small>{describe(print)}</small>
      </span>
    </p>
  );
}

function said(failed: unknown): string {
  return failed instanceof Error ? failed.message : String(failed);
}
