import { type ReactNode, useState } from "react";
import {
  type Card,
  type Catalog,
  image,
  NORMAL,
  type Print,
  type Side,
} from "./catalog";
import { Add } from "./collection/Add";
import { Modal } from "./Modal";
import { describe, hasArt, Language, titled, twoSided } from "./Printing";

// A row of the list that opened this, so the panel can walk the list the way
// it is shown rather than the printings of one card.
export interface Along {
  card: Card;
  print: Print | undefined;
}

// Art is what a printing is chosen by.
export function Printings({
  card,
  catalog,
  name,
  start,
  trigger,
  label,
  along,
  at,
}: {
  card: Card;
  catalog: Catalog;
  name: string;
  // Opens on one printing rather than on the grid of them.
  start?: Print;
  trigger: string;
  label: ReactNode;
  // The whole list and this row's place in it. Absent where there is no list
  // to walk, as from the count of a card's own printings.
  along?: Along[];
  at?: number;
}) {
  const from = at ?? 0;
  const [here, move] = useState(from);
  const one = along?.[here];
  const step =
    along && along.length > 1
      ? (by: number) => move((was) => (was + by + along.length) % along.length)
      : null;

  return (
    <Modal
      wide
      trigger={trigger}
      title={one ? titled(one.card, one.print).text : name}
      label={label}
      // A panel reopened from this row starts on this row, wherever walking
      // left it.
      onOpen={() => move(from)}
    >
      <Gallery
        key={here}
        card={one ? one.card : card}
        catalog={catalog}
        start={one ? one.print : start}
        step={step}
      />
    </Modal>
  );
}

// What the picture is doing, the box it will fill being held either way.
type Showing = "loading" | "shown" | "gone";

// Whether the back is really there is answered by fetching it: a layout that
// usually has one is a reason to offer the turn, not a promise of an image.
function Face({ print }: { print: Print }) {
  const [side, turn] = useState<Side>("front");
  const [turnable, setTurnable] = useState(twoSided(print));
  const [showing, setShowing] = useState<Showing>("loading");

  if (!hasArt(print)) return <span className="noart" />;

  return (
    <span className={`face ${showing}`}>
      <img
        // Its own element per side, so turning starts the wait over.
        key={side}
        src={image(print.id, "normal", side)}
        alt=""
        width={NORMAL.width}
        height={NORMAL.height}
        onLoad={() => setShowing("shown")}
        onError={() => {
          // A back that is not there is the layout having been optimistic.
          // A front that is not there is a picture Scryfall does not hold.
          if (side === "back") {
            setTurnable(false);
            turn("front");
            setShowing("loading");
          } else setShowing("gone");
        }}
      />
      {showing === "loading" && <span className="spin" />}
      {turnable && (
        <button
          type="button"
          className="turn"
          aria-label="Turn the card over"
          onClick={() => {
            turn(side === "front" ? "back" : "front");
            setShowing("loading");
          }}
        >
          ⟳
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
