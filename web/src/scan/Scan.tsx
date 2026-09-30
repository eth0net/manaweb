import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { Link } from "../router";
import { frame, open } from "./camera";
import { engine, index } from "./load";
import { type Read, read } from "./read";
import {
  copies,
  type Entry,
  minus,
  plus,
  reported,
  scanned,
  settled,
  sure,
} from "./scratch";
import type { Scratch } from "./store";

// Development only. The import sits inside the branch, so the module and
// the route it posts to are dropped with it.
const Told = import.meta.env.DEV
  ? lazy(() => import("./Report").then((held) => ({ default: held.Report })))
  : null;

export const SCAN = "/scan";
export const REVIEW = `${SCAN}/review`;

const APP = appLanguage();

type Answer =
  | { at: "none" }
  | { at: "reading" }
  // `frame` names the frame held for this read, whether or not it made a
  // stack. A read that named nothing is the one most worth sending back.
  | { at: "nothing"; frame: string }
  // `stack` names the entry once it is in the list. `offer` is one made and
  // not put there: a read the margin does not carry joins the list when it
  // is agreed with, not because the shutter was pressed.
  | {
      at: "found";
      held: Read;
      frame: string;
      stack: string | null;
      offer: Entry | null;
    };

// The tab is the viewfinder, and what came back is laid over it rather than
// put above it: a run of scanning should not be a run of pages.
export function Scan({
  catalog,
  manifest,
  scratch,
}: {
  catalog: Catalog | null;
  manifest: Manifest | null;
  scratch: Scratch;
}) {
  const { change } = scratch;
  const [camera, setCamera] = useState<"off" | "opening" | "on">("off");
  const [answer, setAnswer] = useState<Answer>({ at: "none" });
  const [problem, setProblem] = useState<string | null>(null);
  // todo(settings): held for the page rather than the person, there being
  // nowhere yet for a preference to live — `docs/scanner.md`.
  const [solid, setSolid] = useState(false);
  // Development only: which held frame a report is being written about, and
  // what to say once one has gone.
  const [telling, setTelling] = useState<string | null>(null);
  const [told, setTold] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const paper = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  // Which attempt is the live one. A flag could not tell them apart, so
  // cancelling and opening again left the first camera arriving to a `true`
  // it did not set, taking the ref, and then being overwritten by the second
  // with nothing left holding it.
  const run = useRef(0);

  // A camera left running is a light left on, so it goes out with the page as
  // well as with the button.
  const stop = useCallback(() => {
    run.current += 1;
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera("off");
    setAnswer({ at: "none" });
    setProblem(null);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    run.current += 1;
    const mine = run.current;
    setCamera("opening");
    setProblem(null);
    try {
      // Both before the camera opens, so the wait is one rather than two and
      // the first scan is not the one that pays for the index.
      if (manifest) await Promise.all([engine(), index(manifest)]);
      const held = await open();
      // Opening a camera takes long enough to leave the page in, or to
      // cancel and ask again, and whatever ran meanwhile had nothing to stop.
      if (run.current !== mine) {
        for (const track of held.getTracks()) track.stop();
        return;
      }
      stream.current = held;
      if (video.current) {
        video.current.srcObject = held;
        await video.current.play();
      }
      if (run.current !== mine) {
        stop();
        return;
      }
      setCamera("on");
    } catch (failed: unknown) {
      // Cancelling clears `srcObject`, which rejects a pending `play`. That
      // is the cancel working, not something to report.
      if (run.current !== mine) return;
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
      const at = new Date().toISOString();
      const id = crypto.randomUUID();
      const made = found ? scanned(found, id, at) : null;
      // Below the floor it waits: a card read twice because the first look
      // was poor is one card, and the count has to say so while scanning
      // rather than after.
      const agreed = made !== null && sure(made);
      if (agreed) change((list) => [...list, made]);
      setAnswer(
        found
          ? {
              at: "found",
              held: found,
              frame: id,
              stack: agreed ? made.id : null,
              offer: agreed ? null : made,
            }
          : { at: "nothing", frame: id },
      );
      if (import.meta.env.DEV && paper.current) {
        // Every read, not only the ones that made a stack: a phantom card and
        // a frame nothing was found in are both worth sending.
        await remember(id, paper.current).catch((failed: unknown) =>
          setProblem(said(failed)),
        );
      }
    } catch (failed: unknown) {
      setAnswer({ at: "none" });
      setProblem(said(failed));
    }
  }, [catalog, change, manifest]);

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
    answer.at === "found" ||
    answer.at === "nothing" ||
    Boolean(problem) ||
    Boolean(scratch.problem);

  // Null once a minus has taken it away, which is what leaves nothing to
  // press.
  const stack =
    answer.at === "found" && answer.stack
      ? (scratch.list.find((one) => one.id === answer.stack) ?? null)
      : null;

  // What the panel describes, whether or not the list holds it yet.
  const offer = answer.at === "found" ? answer.offer : null;

  // Every read holds one, including the read that named nothing.
  const shot =
    answer.at === "found" || answer.at === "nothing" ? answer.frame : null;

  // Kept, not affirmed. Keeping is also how a wrong read gets into the list
  // to be put right, so it cannot stand as somebody naming the card — that
  // is the review's job, and a label nobody gave is the one thing a report
  // must never carry.
  // Picking among the printings one artwork carries, before the stack is
  // kept. Several of them is why it was not kept in the first place.
  function pick(print: Print, finishes: string[]) {
    setAnswer((was) =>
      was.at === "found" && was.offer
        ? {
            ...was,
            offer: {
              ...was.offer,
              scryfallId: print.id,
              picked: true,
              finish: settled(finishes),
            },
          }
        : was,
    );
  }

  function agree(one: Entry) {
    change((list) => [...list, one]);
    setAnswer((was) =>
      was.at === "found" ? { ...was, stack: one.id, offer: null } : was,
    );
  }

  // The stack goes with its last copy, and so does the panel describing it.
  function fewer(one: Entry) {
    change((list) => minus(list, one.id));
    if (one.quantity <= 1) setAnswer({ at: "none" });
  }

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
          {scratch.list.length > 0 && <Waiting list={scratch.list} />}
          {problem && <p className="warn">{problem}</p>}
        </div>
      )}

      {camera === "on" && (
        <div className="scan-foot">
          {Told && telling && (
            <div className={solid ? "scan-said solid" : "scan-said"}>
              <div className="scan-panel">
                <Suspense fallback={<p className="quiet">Opening…</p>}>
                  <Told
                    catalog={catalog}
                    frame={telling}
                    found={answer.at === "found" ? answer.held : null}
                    entry={stack ?? offer}
                    onDone={(sent) => {
                      setTelling(null);
                      setTold(sent);
                      // The stack keeps it, where the read made one.
                      if (sent && stack) {
                        change((list) =>
                          reported(list, stack.id, new Date().toISOString()),
                        );
                      }
                    }}
                  />
                </Suspense>
              </div>
            </div>
          )}

          {answered && !telling && (
            <div className={solid ? "scan-said solid" : "scan-said"}>
              <div className="scan-panel">
                <button
                  type="button"
                  className="scan-veil"
                  onClick={() => setSolid(!solid)}
                  aria-pressed={solid}
                >
                  {solid ? "See through" : "Solid"}
                </button>
                {problem && <p className="warn">{problem}</p>}
                {scratch.problem && <p className="warn">{scratch.problem}</p>}
                {answer.at === "nothing" && (
                  <p>Nothing in that frame looked like a card.</p>
                )}
                {answer.at === "found" && (
                  <Answered
                    found={answer.held}
                    stack={stack ?? offer}
                    onPick={offer ? pick : null}
                  />
                )}
              </div>
              {offer && (
                <p className="scan-count">
                  <button type="button" onClick={() => agree(offer)}>
                    Keep it
                  </button>
                  <span className="quiet">or scan again</span>
                </p>
              )}
              {import.meta.env.DEV && shot && (
                <p className="scan-count">
                  <button
                    type="button"
                    onClick={() => {
                      setTold(false);
                      setTelling(shot);
                    }}
                  >
                    {told ? "Report again" : "Report"}
                  </button>
                  <span className="quiet">
                    {told ? "sent, thank you" : "something is wrong with it"}
                  </span>
                </p>
              )}
              {scratch.list.length > 0 && (
                <p className="scan-count">
                  {stack && (
                    <Counted
                      stack={stack}
                      onFewer={() => fewer(stack)}
                      onMore={() => change((list) => plus(list, stack.id))}
                    />
                  )}
                  <Waiting list={scratch.list} />
                </p>
              )}
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
        </div>
      )}
    </div>
  );
}

// How many of it were seen, kept out of the scroll above so the press that
// undoes a scan is always in the same place.
function Counted({
  stack,
  onFewer,
  onMore,
}: {
  stack: Entry;
  onFewer: () => void;
  onMore: () => void;
}) {
  return (
    <>
      <button type="button" onClick={onFewer} aria-label="One fewer">
        &minus;
      </button>
      <span className="tally">{stack.quantity}</span>
      <button type="button" onClick={onMore} aria-label="One more">
        +
      </button>
    </>
  );
}

// How much is in the list, and the way into it.
function Waiting({ list }: { list: Entry[] }) {
  const held = copies(list);

  return (
    <Link className="link" to={REVIEW}>
      {held.toLocaleString()} card{held === 1 ? "" : "s"} scanned
    </Link>
  );
}

// What came back, and how much to believe it. The runners-up show only where
// the margin is too thin to take, which is the whole of what keeping them is
// for.
function Answered({
  found,
  stack,
  onPick,
}: {
  found: Read;
  stack: Entry | null;
  onPick: ((print: Print, finishes: string[]) => void) | null;
}) {
  // The matches the list could do nothing with are left out here too, or the
  // panel names one card while the stack below it holds another.
  const [first, ...rest] = found.found.filter((one) => one.prints.length > 0);
  const certain = stack ? sure(stack) : found.sure;

  if (!first) {
    return (
      <p className="quiet">No printing in this catalog carries that art.</p>
    );
  }

  // The art match narrowed to these. What picks among them is the collector
  // number on the card, which nothing reads yet — `docs/scanner.md`.
  const several = first.prints.length > 1;
  const chosen = stack?.scryfallId;

  return (
    <>
      <p className={certain ? "tally" : "warn"}>
        {certain
          ? "This is the card."
          : several
            ? "This art, on more than one printing."
            : "Nearest, but not by much."}
        {/* Both can be true at once: the framings guessed at when no outline
            was found still answered, and still answered clear of the floor.
            Said as a caveat rather than as a second verdict. */}
        {!found.detected &&
          " Its outline was not found, so the whole frame was read as the card."}
      </p>

      {first.prints.map(({ card, print }) =>
        onPick && several ? (
          <button
            key={print.id}
            type="button"
            className={print.id === chosen ? "scan-pick chosen" : "scan-pick"}
            onClick={() => onPick(print, print.finishes)}
          >
            <Named card={card} print={print} />
          </button>
        ) : (
          <Named key={print.id} card={card} print={print} />
        ),
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

// The frame a scan read, put by in case the read turns out to be wrong.
// Imported here rather than at the top: the branch goes with the build, and
// the module goes with the branch.
async function remember(id: string, canvas: HTMLCanvasElement): Promise<void> {
  const { hold, snapshot } = await import("./frames");
  await hold(id, await snapshot(canvas));
}

function said(failed: unknown): string {
  return failed instanceof Error ? failed.message : String(failed);
}
