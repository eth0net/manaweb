import { across, type Card, image, type Print, words } from "./catalog";
import { Add } from "./collection/Add";
import { Mana } from "./Mana";
import { describe, hasArt, Language, titled } from "./Printing";

// One card and the printing on show for it. The printing is given rather than
// chosen here, because a search picks it by language and a set is the printing.
export function CardRow({
  card,
  print,
  at,
  onShow,
}: {
  card: Card;
  print: Print | undefined;
  // This row's place in the list, which is what the page's panel is opened on.
  at: number;
  onShow: (at: number, grid?: boolean) => void;
}) {
  const tags = card.kind === "card" ? card.flags : [card.kind, ...card.flags];
  const name = titled(card, print);
  // Both are on the faces for most two-sided cards, and a row reading the
  // card alone showed a blank where the search had just matched.
  const stats = across(card, "stats");
  const cost = across(card, "manaCost");

  return (
    <li>
      <div className="card">
        {print && hasArt(print) && (
          <button type="button" className="art" onClick={() => onShow(at)}>
            <img src={image(print.id, "small")} alt="" loading="lazy" />
          </button>
        )}
        <div>
          <h2>
            {name.text}
            {/* Only when the printing isn't in the language it is read in, so
              an English name over an English printing says nothing. */}
            {print && print.lang !== name.lang && (
              <Language code={print.lang} />
            )}
            {tags.map((tag) => (
              <span className="tag" key={tag}>
                {words(tag)}
              </span>
            ))}
          </h2>
          <p>
            {card.typeLine}
            {stats && <span className="stats">{stats}</span>}
            {cost && <Mana cost={cost} />}
          </p>
          {print && <p className="print">{describe(print)}</p>}
          <div className="meta">
            {print && <Add print={print} />}
            <button
              type="button"
              className="link"
              onClick={() => onShow(at, true)}
            >
              {card.printings} printing{card.printings === 1 ? "" : "s"}
            </button>
            {card.edhrecRank && (
              <span>EDHREC #{card.edhrecRank.toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
