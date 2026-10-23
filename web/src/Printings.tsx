import { useEffect, useState } from "react";
import {
  type Card,
  type Catalog,
  image,
  NORMAL,
  type Print,
  type Side,
} from "./catalog";
import { Add } from "./collection/Add";
import { Panel } from "./Modal";
import { describe, hasArt, Language, titled, twoSided } from "./Printing";

// A row of the list that opened this, so the panel can walk the list the way
// it is shown rather than the printings of one card.
export interface Along {
  card: Card;
  print: Print | undefined;
}

// Which row a page's panel opened on, and whether on that card's printings.
export type Shown = { at: number; grid?: boolean };

// One panel for a whole list, shown by the page rather than opened by a row:
// a container holding thousands of cards mounted a modal for every one.
export function CardPanel({
  catalog,
  along,
  at,
  grid,
  onShut,
}: {
  catalog: Catalog;
  along: Along[];
  at: number;
  // Opened on everything the card was printed as rather than on the one the
  // row showed, which is what the printing count opens.
  grid?: boolean;
  onShut: () => void;
}) {
  const [here, move] = useState(at);
  const [all, showAll] = useState(grid ?? false);
  const one = along[here];
  const step =
    along.length > 1
      ? (by: number) => {
          showAll(false);
          move((was) => (was + by + along.length) % along.length);
        }
      : null;

  // Shut rather than slide to a neighbor when the row this was opened on
  // goes: removing the element fires no close, so the page would otherwise
  // still believe a panel is open and show one again unasked.
  useEffect(() => {
    if (!one) onShut();
  }, [one, onShut]);
  if (!one) return null;

  return (
    <Panel wide title={titled(one.card, one.print).text} onShut={onShut}>
      <Gallery
        // Keyed on what is shown and not on where it is: a row inserted above
        // leaves the heading reading one card and the picture another.
        key={one.print?.id ?? one.card.oracleId}
        card={one.card}
        catalog={catalog}
        start={all ? undefined : one.print}
        step={step}
      />
    </Panel>
  );
}

// Two arrows passing, which is a card going over rather than a page
// reloading — what a single circular arrow was being read as. The layout
// named `flip` is a different thing and not one of these; `licenses/README.md`
// says where the drawing came from.
function Flip() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.09 19h12l-1.3 1.29a1 1 0 0 0 1.42 1.42l3-3a1 1 0 0 0 0-1.42l-3-3a1 1 0 0 0-1.42 0 1 1 0 0 0 0 1.42l1.3 1.29h-12a1.56 1.56 0 0 1-1.59-1.53V13a1 1 0 0 0-2 0v2.47A3.56 3.56 0 0 0 6.09 19z" />
      <path d="M5.79 9.71a1 1 0 1 0 1.42-1.42L5.91 7h12a1.56 1.56 0 0 1 1.59 1.53V11a1 1 0 0 0 2 0V8.53A3.56 3.56 0 0 0 17.91 5h-12l1.3-1.29a1 1 0 0 0 0-1.42 1 1 0 0 0-1.42 0l-3 3a1 1 0 0 0 0 1.42z" />
    </svg>
  );
}

// What the picture is doing, the box it will fill being held either way.
type Showing = "loading" | "shown" | "gone";

// Both sides are mounted and one is shown, so a flip is a class changing
// rather than a fetch: keyed on the side, every flip discarded the element
// and asked for the picture again.
function Face({ print }: { print: Print }) {
  const [side, turn] = useState<Side>("front");
  const [flippable, setFlippable] = useState(twoSided(print));
  const [here, setHere] = useState<Partial<Record<Side, boolean>>>({});
  const [gone, setGone] = useState<Partial<Record<Side, boolean>>>({});

  if (!hasArt(print)) return <span className="noart" />;

  const showing: Showing = gone[side]
    ? "gone"
    : here[side]
      ? "shown"
      : "loading";
  const face = (which: Side) => (
    <img
      className={!gone[which] && which === side ? "here" : undefined}
      src={image(print.id, "normal", which)}
      alt=""
      width={NORMAL.width}
      height={NORMAL.height}
      onLoad={() => setHere((was) => ({ ...was, [which]: true }))}
      onError={() => {
        // A back that is not there is the layout having been optimistic. A
        // front that is not there is a picture Scryfall does not hold.
        if (which === "back") {
          setFlippable(false);
          turn("front");
        } else setGone((was) => ({ ...was, front: true }));
      }}
    />
  );

  return (
    <span className={`face ${showing}`}>
      {face("front")}
      {flippable && face("back")}
      {showing === "loading" && <span className="spin" />}
      {flippable && (
        <button
          type="button"
          className="flip"
          aria-label="Flip the card"
          onClick={() => turn(side === "front" ? "back" : "front")}
        >
          <Flip />
        </button>
      )}
    </span>
  );
}

function Gallery({
  card,
  catalog,
  start,
  step,
}: {
  card: Card;
  catalog: Catalog;
  start?: Print;
  step: ((by: number) => void) | null;
}) {
  const [chosen, choose] = useState<Print | null>(start ?? null);

  // The image is the rules text: the catalog carries none, per
  // `docs/scryfall.md`.
  if (chosen) {
    return (
      <div className="detail">
        <Face key={chosen.id} print={chosen} />
        <p className="back">
          {step && (
            <button
              type="button"
              aria-label="Previous card"
              onClick={() => step(-1)}
            >
              ‹
            </button>
          )}
          <button type="button" className="link" onClick={() => choose(null)}>
            All printings
          </button>
          {step && (
            <button
              type="button"
              aria-label="Next card"
              onClick={() => step(1)}
            >
              ›
            </button>
          )}
        </p>
        <p>
          {chosen.lang !== "en" && <Language code={chosen.lang} />}
          {describe(chosen)}
        </p>
        <p className="row">
          <Add print={chosen} />
        </p>
      </div>
    );
  }

  return (
    <ul className="prints">
      {catalog.prints(card.index).map((one) => (
        <li key={one.id}>
          <button type="button" className="art" onClick={() => choose(one)}>
            {hasArt(one) ? (
              <img src={image(one.id, "small")} alt="" loading="lazy" />
            ) : (
              <span className="noart" />
            )}
          </button>
          <span className="what">
            {one.lang !== "en" && <Language code={one.lang} />}
            {describe(one)}
          </span>
          <span className="row">
            <Add print={one} />
          </span>
        </li>
      ))}
    </ul>
  );
}
