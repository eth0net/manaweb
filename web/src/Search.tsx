import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CardRow } from "./CardRow";
import type { Card, Catalog, Print } from "./catalog";
import { answering, parse, type Query } from "./catalog/query";
import { Colors } from "./filters/Colors";
import { More } from "./filters/Filters";
import { SetFilter } from "./filters/SetFilter";
import { Modes } from "./Nav";
import { amend, Link, useSettings } from "./router";
import { SETS } from "./Sets";

// A cap on what one query collects, so a single letter doesn't gather every
// card containing it. Rows past the fold cost nothing to have — see the CSS.
const FOUND = 600;

export function Search({
  catalog,
  tools,
}: {
  catalog: Catalog;
  tools?: ReactNode;
}) {
  // In the address rather than in this component, which unmounts the moment
  // another tab is opened and would otherwise take the search with it.
  const settings = useSettings();
  const query = settings.get("q") ?? "";

  // Asked for rather than typed at: half a name narrows to nothing useful, and
  // the terms beside it are usually set before the look.
  const [text, setText] = useState(query);
  useEffect(() => setText(query), [query]);

  // A control writes its term into the box and asks at once, which is what
  // keeps the two spellings of a filter one thing.
  const push = (next: string) => {
    setText(next);
    amend({ q: next });
  };

  const parsed = useMemo(() => parse(query), [query]);
  const found = useMemo(
    () => catalog.find(parsed, { limit: FOUND }),
    [catalog, parsed],
  );

  return (
    <>
      <Modes path="/cards" />
      <form
        className="tools"
        onSubmit={(event) => {
          event.preventDefault();
          amend({ q: text });
        }}
      >
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search cards"
        />
        <button type="submit">Search</button>
        <Colors text={text} onText={push} />
        <More catalog={catalog} text={text} onText={push} />
        <SetFilter catalog={catalog} text={text} onText={push} />
        {tools}
      </form>

      {parsed.missing.length > 0 && (
        <p className="warn">
          Not on this device: {parsed.missing.join(", ")}.
        </p>
      )}

      {!query ? (
        <p className="quiet">
          Search by name, or <Link to={SETS}>browse by set</Link>.
        </p>
      ) : found.length === 0 ? (
        <p>Nothing matches “{query}”.</p>
      ) : (
        <ol className="results">
          {found.map((card) => (
            <CardRow
              key={card.oracleId}
              card={card}
              catalog={catalog}
              print={shown(catalog, card, parsed)}
            />
          ))}
        </ol>
      )}
    </>
  );
}

// The printing a row shows is one that answered the query, so a search for a
// set or a language is illustrated by what it found rather than the default.
function shown(catalog: Catalog, card: Card, query: Query): Print | undefined {
  const prints = catalog.prints(card.index);
  return answering(query, card, prints) ?? prints[0];
}
