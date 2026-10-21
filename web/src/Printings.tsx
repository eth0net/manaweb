import { type ReactNode, useState } from "react";
import {
  type Card,
  type Catalog,
  image,
  type Print,
  type Side,
} from "./catalog";
import { Add } from "./collection/Add";
import { Modal } from "./Modal";
import { describe, hasArt, Language, twoSided } from "./Printing";

// Art is what a printing is chosen by.
export function Printings({
  card,
  catalog,
  name,
  start,
  trigger,
  label,
}: {
  card: Card;
  catalog: Catalog;
  name: string;
  // Opens on one printing rather than on the grid of them.
  start?: Print;
  trigger: string;
  label: ReactNode;
}) {
  return (
    <Modal wide trigger={trigger} title={name} label={label}>
      <Gallery card={card} catalog={catalog} start={start} />
    </Modal>
  );
}

// Whether the back is really there is answered by fetching it: a layout that
// usually has one is a reason to offer the turn, not a promise of an image.
function Face({ print }: { print: Print }) {
  const [side, turn] = useState<Side>("front");
  const [turnable, setTurnable] = useState(twoSided(print));

  if (!hasArt(print)) return null;

  return (
    <>
      <img
        src={image(print.id, "normal", side)}
        alt=""
        onError={() => {
          setTurnable(false);
          turn("front");
        }}
      />
      {turnable && (
        <p className="actions">
          <button
            type="button"
            onClick={() => turn(side === "front" ? "back" : "front")}
          >
            Turn over
          </button>
        </p>
      )}
    </>
  );
}

function Gallery({
  card,
  catalog,
  start,
}: {
  card: Card;
  catalog: Catalog;
  start?: Print;
}) {
  const [chosen, choose] = useState<Print | null>(start ?? null);

  // The image is the rules text: the catalog carries none, per
  // `docs/scryfall.md`.
  if (chosen) {
    return (
      <div className="detail">
        <p className="back">
          <button type="button" className="link" onClick={() => choose(null)}>
            ← All printings
          </button>
        </p>
        <Face key={chosen.id} print={chosen} />
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
