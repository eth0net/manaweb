// The list before it is kept: what each scan made of a card, and the presses
// that put a wrong read right — `docs/scanner.md`.

import type { OAuthSession } from "@atproto/oauth-client-browser";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  appLanguage,
  type Card,
  type Catalog,
  cardName,
  image,
  type Print,
} from "../catalog";
import type { Holdings, Owned } from "../collection/cards";
import { IMPORT } from "../import/Import";
import { plan, weigh } from "../import/plan";
import { digest, sha } from "../import/receipt";
import { begin, useImport } from "../import/runner";
import { describe, hasArt } from "../Printing";
import { Link } from "../router";
import { SCAN } from "./Scan";
import {
  cards,
  choose,
  copies,
  drop,
  type Entry,
  type Finishes,
  joinable,
  merged,
  minus,
  plus,
  refinish,
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
  const wanted = useMemo(() => {
    const all = new Set<string>();
    for (const one of list) {
      for (const { prints } of one.matched)
        for (const id of prints) all.add(id);
    }
    return [...all].sort().join(" ");
  }, [list]);

  const prints = useMemo(
    () => catalog.resolve(wanted ? wanted.split(" ") : []),
    [catalog, wanted],
  );

  const finishes: Finishes = useCallback(
    (id: string) => prints.get(id)?.print.finishes ?? [],
    [prints],
  );

  const running = useImport();
  const [keeping, setKeeping] = useState(false);
  const [problem, setProblem] = useState("");

  // What keeping the list does to the collection, which is the arithmetic a
  // file is asked for before it lands.
  const weight = useMemo(() => {
    if (!owning.ready || list.length === 0) return null;
    const owned = cards(list, container);
    const at = new Date().toISOString();
    return weigh(plan(owned, owning.stacks, at), owning.stacks);
  }, [container, list, owning.ready, owning.stacks]);

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
        source: SOURCE,
        digest: await stamped(owned, at),
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

  const back = (
    <p className="quiet">
      <Link className="link" to={SCAN}>
        Back to the camera
      </Link>
    </p>
  );

  if (list.length === 0) {
    return (
      <>
        {back}
        <p className="quiet">Nothing scanned yet.</p>
      </>
    );
  }

  const held = copies(list);
  const joins = joinable(list);

  return (
    <>
      {back}
      <p className="tally">
        {held.toLocaleString()} card{held === 1 ? "" : "s"}
        <span className="quiet">
          {" "}
          · {list.length} stack{list.length === 1 ? "" : "s"}
        </span>
      </p>

      {joins > 0 && (
        <p>
          <button
            type="button"
            onClick={() => change(merged)}
            disabled={keeping}
          >
            Join {joins} stack{joins === 1 ? "" : "s"} of a card already here
          </button>
        </p>
      )}

      {tools}

      {session ? (
        // An import in flight owns the same job record, so keeping now would
        // take the place of one already half written.
        running.at !== "none" && running.at !== "done" ? (
          <p className="warn">
            An import holds the place these would go.{" "}
            <Link className="link" to={IMPORT}>
              Finish or discard it
            </Link>
            . These cards wait here meanwhile.
          </p>
        ) : !owning.ready ? (
          // Planned against an empty collection, every copy reads as new and
          // the receipt records a count nothing supports.
          <p className="quiet">Reading what you already own…</p>
        ) : (
          <p>
            <button
              type="button"
              onClick={() => void keep()}
              disabled={keeping}
            >
              Keep {held.toLocaleString()} card{held === 1 ? "" : "s"}
            </button>
          </p>
        )
      ) : (
        <p className="quiet">Sign in to keep these.</p>
      )}

      {weight && weight.joined > 0 && (
        <p className="quiet">
          {weight.joined.toLocaleString()} of them join a stack you already
          hold.
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
            finishes={finishes}
            change={change}
            frozen={keeping}
          />
        ))}
      </ul>
    </>
  );
}

function Stack({
  one,
  prints,
  finishes,
  change,
  frozen,
}: {
  one: Entry;
  prints: Map<string, Found>;
  finishes: Finishes;
  change: Change;
  frozen: boolean;
}) {
  const held = prints.get(one.scryfallId) ?? null;
  const made = finishes(one.scryfallId);
  const others = one.matched.flatMap(({ prints: ids }) => ids);

  return (
    <li>
      <div className="scratch-card">
        {held && hasArt(held.print) && (
          <img
            src={image(held.print.id, "small")}
            alt=""
            width="48"
            height="67"
          />
        )}
        <div className="scratch-what">
          <Title held={held} />
          <small className="quiet">{one.finish}</small>
          {!sure(one) && (
            <small className="warn">Nearest, but not by much.</small>
          )}
          {!one.detected && (
            <small className="quiet">
              No outline was found, so the frame was read whole.
            </small>
          )}
        </div>
        <div className="scratch-count">
          <button
            type="button"
            onClick={() => change((list) => minus(list, one.id))}
            aria-label="One fewer"
            disabled={frozen}
          >
            &minus;
          </button>
          <span className="tally">{one.quantity}</span>
          <button
            type="button"
            onClick={() => change((list) => plus(list, one.id))}
            aria-label="One more"
            disabled={frozen}
          >
            +
          </button>
        </div>
      </div>

      <details>
        <summary>Not this one</summary>
        {made.length > 1 && (
          <p className="scratch-finishes">
            {made.map((finish) => (
              <button
                key={finish}
                type="button"
                className={finish === one.finish ? "chosen" : undefined}
                aria-pressed={finish === one.finish}
                onClick={() =>
                  change((list) => refinish(list, one.id, finish, finishes))
                }
              >
                {finish}
              </button>
            ))}
          </p>
        )}

        <ul className="scratch-prints">
          {others.map((id) => {
            const other = prints.get(id);
            if (!other) return null;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={id === one.scryfallId ? "chosen" : undefined}
                  aria-pressed={id === one.scryfallId}
                  onClick={() =>
                    change((list) => choose(list, one.id, id, finishes))
                  }
                  disabled={frozen}
                >
                  <Title held={other} />
                </button>
              </li>
            );
          })}
        </ul>

        <p>
          <button
            type="button"
            onClick={() => change((list) => drop(list, one.id))}
            disabled={frozen}
          >
            Nothing like it
          </button>
        </p>
      </details>
    </li>
  );
}

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
