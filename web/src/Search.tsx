import { useMemo } from "react";
import { CardRow } from "./CardRow";
import { type Catalog, language } from "./catalog";
import { Explore } from "./Explore";
import { amend, useSettings } from "./router";

// A cap on what one query collects, so a single letter doesn't gather every
// card containing it. Rows past the fold cost nothing to have — see the CSS.
const FOUND = 600;

export function Search({ catalog }: { catalog: Catalog }) {
  // In the address rather than in this component, which unmounts the moment
  // another tab is opened and would otherwise take the search with it.
  const settings = useSettings();
  const query = settings.get("q") ?? "";
  const lang = settings.get("lang") ?? "";

  // A few milliseconds per keystroke, so no debounce.
  const found = useMemo(
    () => catalog.search(query, { lang, limit: FOUND }),
    [catalog, query, lang],
  );

  return (
    <>
      <div className="query">
        <input
          type="search"
          value={query}
          onChange={(event) => amend({ q: event.target.value })}
          placeholder="Search cards"
        />
        <select
          value={lang}
          onChange={(event) => amend({ lang: event.target.value })}
        >
          <option value="">Any language</option>
          {catalog.languages.map((code) => (
            <option key={code} value={code}>
              {language(code)}
            </option>
          ))}
        </select>
      </div>

      {/* One growing list at a time, or two would split the height. */}
      {!query ? (
        <Explore catalog={catalog} />
      ) : found.length === 0 ? (
        <p>
          Nothing matches “{query}”
          {lang && ` with a ${language(lang)} printing`}.
        </p>
      ) : (
        <ol className="results">
          {found.map((card) => (
            <CardRow
              key={card.oracleId}
              card={card}
              catalog={catalog}
              // Filtered, so the printing shown is one that answers the search.
              print={catalog.prints(card.index, lang)[0]}
            />
          ))}
        </ol>
      )}
    </>
  );
}
