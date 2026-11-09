// The list before it is kept: what each scan made of a card, and the presses
// that put a wrong read right — `docs/scanner.md`.

import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  appLanguage,
  type Card,
  type Catalog,
  cardName,
  image,
  type Print,
  words,
} from "../catalog";
import { FLOOR } from "../catalog/artwork";
import { parse } from "../catalog/query";
import {
  CONDITIONS,
  COPIES,
  type Holdings,
  type Owned,
} from "../collection/cards";
import { IMPORT } from "../import/Import";
import { plan, weigh } from "../import/plan";
import { digest, sha } from "../import/receipt";
import { begin, useImport } from "../import/runner";
import { Panel } from "../Modal";
import { brief, describe, hasArt } from "../Printing";
import { Link } from "../router";
import type { Said } from "./frames";
import { SCAN } from "./Scan";
import {
  cards,
  choose,
  copies,
  counted,
  drop,
  type Entry,
  type Finishes,
  joinable,
  merged,
  offered,
  referenced,
  refinish,
  regraded,
  reported,
  type Source,
  settled,
  sure,
} from "./scratch";
import type { Scratch } from "./store";

const APP = appLanguage();

// What the cards were read out of, which is all the receipt records of where
// an import came from.
const SOURCE = "Scan";

// A receipt is keyed by its digest, and two scans of one card are two real
// piles rather than the same list twice — so the moment goes in, where a file
// would want the opposite.
async function stamped(owned: Owned[], at: string): Promise<string> {
  return `sha256-${await sha(`${at}\n${await digest(owned)}`)}`;
}

// A file's receipt is the file's: its own name and its own digest, taken when
// it was read rather than off the list somebody has since been editing.
async function receipt(
  source: Source,
  owned: Owned[],
  at: string,
): Promise<{ source: string; file?: string; digest: string }> {
  if (source.at === "file") {
    return { source: source.format, file: source.file, digest: source.digest };
  }
  return { source: SOURCE, digest: await stamped(owned, at) };
}

type Found = { card: Card; print: Print };
type Change = Scratch["change"];

export function Review({
  catalog,
  scratch,
  session,
  owning,
  container,
  tools,
}: {
  catalog: Catalog;
  scratch: Scratch;
  session: OAuthSession | null;
  owning: Holdings;
  container: string | null;
  tools: ReactNode;
}) {
  const { list, change } = scratch;

  // Changes only when a scan or a removal moves them, so a press on a count
  // does not send the catalog looking again.
  const wanted = useMemo(() => referenced(list).join(" "), [list]);

  const prints = useMemo(
    () => catalog.resolve(wanted ? wanted.split(" ") : []),
    [catalog, wanted],
  );

  const finishes: Finishes = useCallback(
    (id: string) => prints.get(id)?.print.finishes ?? [],
    [prints],
  );

  // Where the list came from, which decides what is behind it and what the
  // way back out of here is. Held rather than read each render: keeping a
  // file's list empties it, and the screen still has to say where it went.
  const [came, setCame] = useState(scratch.source);
  useEffect(() => {
    // A scan only takes it back once there are cards, or clearing a file
    // would relabel the empty screen that follows.
    if (scratch.source.at === "file" || list.length > 0) {
      setCame(scratch.source);
    }
  }, [scratch.source, list.length]);

  const file = came.at === "file" ? came : null;
  const back = file ? IMPORT : SCAN;

  const running = useImport();
  const [keeping, setKeeping] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [problem, setProblem] = useState("");

  // Which row has the panel open, rather than a panel apiece: a list of
  // thousands would mount every one of them to show a single dialog.
  const [editing, setEditing] = useState<string | null>(null);
  // Looked up each render rather than held: a panel open over a row somebody
  // has since changed has to show what the row says now.
  const edited = list.find((one) => one.id === editing) ?? null;

  // What keeping the list does to the collection, which is the arithmetic a
  // file is asked for before it lands.
  const weight = useMemo(() => {
    if (!owning.ready || list.length === 0) return null;
    const owned = cards(list, container);
    const at = new Date().toISOString();
    return weigh(plan(owned, owning.stacks, at), owning.stacks);
  }, [container, list, owning.ready, owning.stacks]);

  // Stacks whose printing the collection already holds but which the plan
  // did not join. A grade apart is the usual reason, and nothing else on this
  // page would say so.
  const apart = useMemo(() => {
    if (!owning.ready || !weight) return 0;
    const known = list.filter(
      (one) => owning.owned(one.scryfallId, one.finish) > 0,
    ).length;
    return Math.max(0, known - weight.joined);
  }, [list, owning, weight]);

  async function keep() {
    setKeeping(true);
    setProblem("");
    try {
      const owned = cards(list, container);
      const at = new Date().toISOString();
      const weighed = weigh(plan(owned, owning.stacks, at), owning.stacks);
      // The list is the only copy of these cards, so it goes only once the
      // job that carries them is written down.
      const why = await begin(owned, {
        ...(await receipt(scratch.source, owned, at)),
        cards: weighed.adding,
        stacks: owned.length,
        createdAt: at,
      });
      if (why) {
        setProblem(`${why} The list is still here.`);
        return;
      }
      await scratch.clear();
    } catch (failed: unknown) {
      setProblem(failed instanceof Error ? failed.message : String(failed));
    } finally {
      setKeeping(false);
    }
  }

  // The frame goes with the stack, so a scan says what it missed before the
  // row carrying it goes.
  async function discard(one: Entry): Promise<void> {
    if (import.meta.env.DEV && scratch.source.at === "scan") {
      await told(one, null);
    }
    change((list) => drop(list, one.id));
  }

  // The list is the only copy of these cards, so the press that throws them
  // away is a quiet one and it asks first.
  async function away() {
    setClearing(false);
    setProblem("");
    try {
      await scratch.clear();
    } catch (failed: unknown) {
      setProblem(failed instanceof Error ? failed.message : String(failed));
    }
  }

  if (list.length === 0) {
    return (
      <>
        <p className="quiet">
          <Link className="link" to={back}>
            {file ? "Back to importing" : "Back to the camera"}
          </Link>
        </p>
        {scratch.problem && <p className="warn">{scratch.problem}</p>}
        {problem ? (
          <p className="warn">{problem}</p>
        ) : (
          <p className="quiet">
            {file ? "Nothing left of that file." : "Nothing scanned yet."}
          </p>
        )}
      </>
    );
  }

  const held = copies(list);
  const joins = joinable(list);

  return (
    <>
      <div className="scratch-head">
        <Link className="link" to={back}>
          Back
        </Link>
        <p className="tally">
          {held.toLocaleString()} card{held === 1 ? "" : "s"}
          <span className="quiet">
            {" "}
            · {list.length} stack{list.length === 1 ? "" : "s"}
          </span>
        </p>
        <button
          type="button"
          className="link"
          onClick={() => setClearing(true)}
          disabled={keeping}
        >
          Clear
        </button>
      </div>

      {file && (
        <p className="scratch-from quiet">
          <span className="scratch-file">{file.file || "A file"}</span>
          <span>· read as {file.format}, rows in file order</span>
        </p>
      )}

      {clearing ? (
        <p className="scratch-clear" aria-live="polite">
          <span className="warn">
            Throw away {held.toLocaleString()} card{held === 1 ? "" : "s"}?{" "}
            {held === 1 ? "It is" : "They are"} not written anywhere else.
          </span>
          <button type="button" onClick={() => void away()} disabled={keeping}>
            Throw them away
          </button>
          <button type="button" onClick={() => setClearing(false)}>
            Leave them here
          </button>
        </p>
      ) : (
        <div className="scratch-does">
          {tools}
          {!session ? (
            <span className="quiet">Sign in to keep</span>
          ) : // An import in flight owns the same job record, so keeping now
          // would take the place of one already half written.
          running.at !== "none" && running.at !== "done" ? (
            <span className="warn">
              An import holds the place these would go.{" "}
              <Link className="link" to={IMPORT}>
                Finish or discard it
              </Link>
              . These cards wait here meanwhile.
            </span>
          ) : !owning.ready ? (
            // Planned against an empty collection, every copy reads as new
            // and the receipt records a count nothing supports.
            <span className="quiet">Reading what you already own…</span>
          ) : (
            <button
              type="button"
              onClick={() => void keep()}
              disabled={keeping}
            >
              Keep {held.toLocaleString()} card{held === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}

      {joins > 0 && (
        <p>
          <button
            type="button"
            onClick={() => change((held) => merged(held))}
            disabled={keeping}
          >
            Join {joins} stack{joins === 1 ? "" : "s"} of a card already here
          </button>
        </p>
      )}

      {weight && weight.joined > 0 && (
        <p className="quiet">
          {weight.joined.toLocaleString()} of them join a stack you already
          hold.
        </p>
      )}

      {apart > 0 && (
        <p className="quiet">
          {apart.toLocaleString()}{" "}
          {apart === 1 ? "is a printing" : "are printings"} you own already but
          filed otherwise — another grade, or another place — so{" "}
          {apart === 1 ? "it stays a stack" : "they stay stacks"} of
          {apart === 1 ? " its" : " their"} own.
        </p>
      )}

      {scratch.problem && <p className="warn">{scratch.problem}</p>}

      {problem && <p className="warn">{problem}</p>}

      <ul className="scratch">
        {list.map((one) => (
          <Stack
            key={one.id}
            one={one}
            prints={prints}
            frozen={keeping}
            scanned={scratch.source.at === "scan"}
            onEdit={() => setEditing(one.id)}
            onDrop={() => void discard(one)}
          />
        ))}
      </ul>

      {edited && (
        <Editing
          key={edited.id}
          catalog={catalog}
          one={edited}
          prints={prints}
          finishes={finishes}
          change={change}
          frozen={keeping}
          scanned={scratch.source.at === "scan"}
          onShut={() => setEditing(null)}
        />
      )}
    </>
  );
}

// What a reported frame is filed under. The scoring harness reads a name of
// this shape, so a miss reported here needs nothing named by hand later —
// `docs/scanner.md`.
export function labeled(print: Print): string {
  const lang = print.lang === "en" ? "" : `-${print.lang}`;
  return `${print.set}-${print.collectorNumber}${lang}`;
}

// Dev only, and reached by dynamic import so the module and the route it
// posts to go with the branch.
async function told(one: Entry, answer: Said | null): Promise<void> {
  const { reading, send } = await import("./frames");
  await send(one.id, { read: reading(one), answer, wrong: "" });
}

// Naming the card when what came back does not hold it — `docs/scanner.md`.
export function Finding({
  catalog,
  onPick,
}: {
  catalog: Catalog;
  onPick: (print: Print) => void;
}) {
  const [text, setText] = useState("");
  const [card, setCard] = useState<Card | null>(null);

  const found = useMemo(() => {
    const asked = text.trim();
    return asked.length < 2 ? [] : catalog.find(parse(asked), { limit: 6 });
  }, [catalog, text]);

  const printings = useMemo(
    () => (card ? catalog.prints(card.index) : []),
    [catalog, card],
  );

  return (
    <div className="scratch-find">
      <input
        type="search"
        value={text}
        placeholder="Name the card instead"
        onChange={(event) => {
          setText(event.target.value);
          setCard(null);
        }}
      />
      {(found.length > 0 || printings.length > 0) && (
        <ul className="scratch-prints">
          {!card &&
            found.map((one) => (
              <li key={one.index}>
                <button type="button" onClick={() => setCard(one)}>
                  {one.name}
                </button>
              </li>
            ))}
          {printings.map((print) => (
            <li key={print.id}>
              <button type="button" onClick={() => onPick(print)}>
                {describe(print)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stack({
  one,
  prints,
  frozen,
  scanned,
  onEdit,
  onDrop,
}: {
  one: Entry;
  prints: Map<string, Found>;
  frozen: boolean;
  scanned: boolean;
  onEdit: () => void;
  onDrop: () => void;
}) {
  const held = prints.get(one.scryfallId) ?? null;
  const named = held ? cardName(held.card.name, held.print, APP) : null;
  // A badge of its own rather than a line or a button: the row is itself the
  // press that answers it.
  const doubt =
    scanned && ((!sure(one) && !one.picked) || one.detected === false);

  return (
    <li>
      <div className="scratch-card">
        <button
          type="button"
          className="scratch-open"
          aria-haspopup="dialog"
          onClick={onEdit}
          disabled={frozen}
        >
          {held && hasArt(held.print) ? (
            <img
              className="scratch-art"
              src={image(held.print.id, "small")}
              alt=""
            />
          ) : (
            <span className="scratch-art scratch-blank" />
          )}
          <span className="scratch-what">
            <span
              className={named ? "scratch-name" : "scratch-name scratch-wraps"}
            >
              <span className="quiet">{one.quantity}&times;</span>{" "}
              {named ? (
                <span lang={named.lang}>{named.text}</span>
              ) : (
                <span className="quiet">
                  No printing in this catalog carries it
                </span>
              )}
            </span>
            <span className="scratch-meta quiet">{meta(held, one)}</span>
            <span className="scratch-badges">
              <span className="badge">{one.finish}</span>
              <span className="badge">
                {one.condition ? words(one.condition) : "ungraded"}
              </span>
              {doubt && <span className="badge warn">unsure</span>}
            </span>
          </span>
        </button>
        <span className="scratch-acts">
          <button
            type="button"
            aria-label="Change this stack"
            aria-haspopup="dialog"
            onClick={onEdit}
            disabled={frozen}
          >
            <Pencil />
          </button>
          <button
            type="button"
            aria-label="Take this stack off the list"
            onClick={onDrop}
            disabled={frozen}
          >
            <Bin />
          </button>
        </span>
      </div>
    </li>
  );
}

// Drawn rather than set in type, so the pair matches whatever font a phone
// falls back to — `licenses/README.md` says where they came from.
function Pencil() {
  return (
    <svg viewBox="0 0 24 24" className="stroked" aria-hidden="true">
      <path d="M12 4H6C4.89543 4 4 4.89543 4 6V18C4 19.1046 4.89543 20 6 20H18C19.1046 20 20 19.1046 20 18V12M9 15V12.5L17.75 3.75C18.4404 3.05964 19.5596 3.05964 20.25 3.75V3.75C20.9404 4.44036 20.9404 5.55964 20.25 6.25L15.5 11L11.5 15H9Z" />
    </svg>
  );
}

function Bin() {
  return (
    <svg viewBox="0 0 24 24" className="stroked" aria-hidden="true">
      <path d="M6 7V18C6 19.1046 6.89543 20 8 20H16C17.1046 20 18 19.1046 18 18V7M6 7H5M6 7H8M18 7H19M18 7H16M10 11V16M14 11V16M8 7V5C8 3.89543 8.89543 3 10 3H14C15.1046 3 16 3.89543 16 5V7M8 7H16" />
    </svg>
  );
}

// The printing and the line it was read off, on one line because neither
// fills one.
function meta(held: Found | null, one: Entry): string {
  return [
    held ? brief(held.print) : "",
    one.line === undefined ? "" : `Line ${one.line}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Everything about a stack, the printing and the count included. Nothing
// lands until Confirm.
function Editing({
  catalog,
  one,
  prints,
  finishes,
  change,
  frozen,
  scanned,
  onShut,
}: {
  catalog: Catalog;
  one: Entry;
  prints: Map<string, Found>;
  finishes: Finishes;
  change: Change;
  frozen: boolean;
  scanned: boolean;
  onShut: () => void;
}) {
  const held = prints.get(one.scryfallId) ?? null;
  const others = (one.matched ?? []).flatMap(({ prints: ids }) => ids);
  // Null until a printing is pressed, so confirming a panel nobody touched
  // does not file the reader's guess as somebody's answer.
  const [picked, setPicked] = useState<Print | null>(null);
  const [quantity, setQuantity] = useState(one.quantity);
  const [finish, setFinish] = useState(one.finish);
  const [condition, setCondition] = useState(one.condition);
  const [sending, setSending] = useState(false);
  const [trouble, setTrouble] = useState("");

  // A printing named by search is in no list the catalog resolved for this
  // page, so what it was made in comes off the printing itself.
  const made: Finishes = (id) =>
    id === picked?.id ? picked.finishes : finishes(id);

  const shown = picked ?? held?.print ?? null;
  const makes = made(shown?.id ?? one.scryfallId);

  function take(print: Print): void {
    setPicked(print);
    if (!print.finishes.includes(finish)) setFinish(settled(print.finishes));
  }

  function confirm(): void {
    change((list) => {
      const now = picked ? choose(list, one.id, picked.id, made) : list;
      const grade = regraded(
        refinish(now, one.id, finish, made),
        one.id,
        condition,
      );
      return counted(grade, one.id, quantity);
    });
    onShut();
  }

  // Reported before it goes, since the frame goes with the stack.
  async function send(answer: string | null): Promise<void> {
    setSending(true);
    setTrouble("");
    try {
      const at = new Date().toISOString();
      await told(
        one,
        answer && held
          ? {
              print: held.print.id,
              label: labeled(held.print),
              finish: one.finish,
              matched: offered(one, held.print.id),
            }
          : null,
      );
      change((list) => reported(list, one.id, at));
      setTrouble("");
    } catch (failed: unknown) {
      setTrouble(failed instanceof Error ? failed.message : String(failed));
    } finally {
      setSending(false);
    }
  }

  return (
    <Panel
      title="Change this stack"
      onShut={onShut}
      actions={
        <>
          <button type="button" onClick={onShut}>
            Cancel
          </button>
          <button
            type="button"
            className="chosen"
            onClick={confirm}
            disabled={frozen}
          >
            Confirm
          </button>
        </>
      }
    >
      <div className="stack-edit">
        {scanned && !sure(one) && !one.picked && (
          <p className="warn">
            {(one.margin ?? 0) >= FLOOR
              ? "This art is on more than one printing."
              : "Nearest, but not by much."}
          </p>
        )}
        {scanned && one.detected === false && (
          <p className="quiet">
            No outline was found, so the frame was read whole.
          </p>
        )}

        <h3>Printing</h3>
        <p className="quiet">
          {shown ? describe(shown) : "No printing in this catalog carries it"}
        </p>
        {others.length > 0 && (
          <ul className="scratch-prints">
            {others.map((id) => {
              const other = prints.get(id);
              if (!other) return null;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={id === shown?.id ? "chosen" : undefined}
                    aria-pressed={id === shown?.id}
                    onClick={() => take(other.print)}
                  >
                    <Title held={other} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Finding catalog={catalog} onPick={take} />

        <h3>Copies</h3>
        <div className="scratch-count">
          <button
            type="button"
            aria-label="One fewer"
            onClick={() => setQuantity((was) => Math.max(1, was - 1))}
          >
            &minus;
          </button>
          <span className="tally">{quantity}</span>
          <button
            type="button"
            aria-label="One more"
            onClick={() => setQuantity((was) => Math.min(COPIES, was + 1))}
          >
            +
          </button>
        </div>

        <h3>Finish</h3>
        {makes.length > 1 ? (
          <p className="scratch-finishes">
            {makes.map((was) => (
              <button
                key={was}
                type="button"
                className={was === finish ? "chosen" : undefined}
                aria-pressed={was === finish}
                onClick={() => setFinish(was)}
              >
                {was}
              </button>
            ))}
          </p>
        ) : (
          <p className="quiet">It was only made in {finish}.</p>
        )}

        <h3>Condition</h3>
        <p>
          <select
            aria-label="Condition"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
          >
            <option value="">ungraded</option>
            {CONDITIONS.map((grade) => (
              <option key={grade} value={grade}>
                {words(grade)}
              </option>
            ))}
          </select>
        </p>

        {import.meta.env.DEV && scanned && (
          <p className="scratch-report">
            <button
              type="button"
              onClick={() => void send(one.picked ? one.scryfallId : null)}
              disabled={frozen || sending}
            >
              {sending
                ? "Reporting\u2026"
                : one.reported
                  ? "Report again"
                  : "Report"}
            </button>
          </p>
        )}
        {import.meta.env.DEV && scanned && (
          <small className="quiet">
            {one.picked
              ? `Reports as ${held ? describe(held.print) : one.scryfallId}.`
              : "Reports the frame and no answer \u2014 name the card first to say what it was."}
          </small>
        )}
        {trouble && <small className="warn">{trouble}</small>}
      </div>
    </Panel>
  );
}

// Names a printing well enough to tell it from another of the same card,
// which is what every list of them here is for.
function Title({ held }: { held: Found | null }) {
  if (!held) {
    return (
      <span className="quiet">No printing in this catalog carries it</span>
    );
  }

  const named = cardName(held.card.name, held.print, APP);
  return (
    <span>
      <span lang={named.lang}>{named.text}</span>
      <br />
      <small className="quiet">{describe(held.print)}</small>
    </span>
  );
}
