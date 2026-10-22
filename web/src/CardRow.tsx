import { type Card, type Catalog, image, type Print, words } from "./catalog";
import { Add } from "./collection/Add";
import { Mana } from "./Mana";
import { describe, hasArt, Language, titled } from "./Printing";
import { type Along, Printings } from "./Printings";

// One card and the printing on show for it. The printing is given rather than
// chosen here, because a search picks it by language and a set is the printing.
export function CardRow({
  card,
  print,
  catalog,
  along,
  at,
}: {
  card: Card;
  print: Print | undefined;
  catalog: Catalog;
  // What the list shows, so the panel walks that rather than this card.
  along?: Along[];
  at?: number;
}) {
  const tags = card.kind === "card" ? card.flags : [card.kind, ...card.flags];
  const name = titled(card, print);

  return (
    <li>
      <div className="card">
        {print && hasArt(print) && (
          <Printings
            card={card}
            catalog={catalog}
            name={name.text}
            start={print}
            along={along}
            at={at}
            trigger="art"
            label={
              <img src={image(print.id, "small")} alt="" loading="lazy" />
            }
          />
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
            {card.stats && <span className="stats">{card.stats}</span>}
            {card.manaCost && <Mana cost={card.manaCost} />}
          </p>
          {print && <p className="print">{describe(print)}</p>}
          <div className="meta">
            {print && <Add print={print} />}
            <Printings
              card={card}
              catalog={catalog}
              name={name.text}
              trigger="link"
              label={`${card.printings} printing${
                card.printings === 1 ? "" : "s"
              }`}
            />
            {card.edhrecRank && (
              <span>EDHREC #{card.edhrecRank.toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
