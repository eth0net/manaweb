// The list before it is kept: what each scan made of a card, and the presses
// that put a wrong read right — `docs/scanner.md`.

import { useCallback, useMemo } from "react";
import {
  appLanguage,
  type Card,
  type Catalog,
  cardName,
  image,
  type Print,
} from "../catalog";
import { describe, hasArt } from "../Printing";
import { Link } from "../router";
import { SCAN } from "./Scan";
import {
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

type Found = { card: Card; print: Print };
type Change = Scratch["change"];

export function Review({
  catalog,
  scratch,
}: {
  catalog: Catalog;
  scratch: Scratch;
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
          <button type="button" onClick={() => change(merged)}>
            Join {joins} stack{joins === 1 ? "" : "s"} of a card already here
          </button>
        </p>
      )}

      <ul className="scratch">
        {list.map((one) => (
          <Stack
            key={one.id}
            one={one}
            prints={prints}
            finishes={finishes}
            change={change}
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
}: {
  one: Entry;
  prints: Map<string, Found>;
  finishes: Finishes;
  change: Change;
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
          >
            &minus;
          </button>
          <span className="tally">{one.quantity}</span>
          <button
            type="button"
            onClick={() => change((list) => plus(list, one.id))}
            aria-label="One more"
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
