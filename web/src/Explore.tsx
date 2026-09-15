import { useMemo } from "react";
import { CardRow } from "./CardRow";
import type { Catalog } from "./catalog";
import { useOwning } from "./collection/context";
import { amend, useSettings } from "./router";

// What an empty search box shows. Browsing 988 sets answers "what did this set
// hold" without a query, which paging 37,564 cards blindly would not.
export function Explore({ catalog }: { catalog: Catalog }) {
  // In the address, so a set survives the tab being left and the back button
  // leaves it. Anything else navigated into wants the same.
  const settings = useSettings();
  const code = settings.get("set") ?? "";
  const filter = settings.get("find") ?? "";

  return code ? (
    <Printings
      catalog={catalog}
      code={code}
      onBack={() => amend({ set: "" }, true)}
    />
  ) : (
    <Sets
      catalog={catalog}
      filter={filter}
      onFilter={(find) => amend({ find })}
      onSet={(set) => amend({ set }, true)}
    />
  );
}

function Sets({
  catalog,
  filter,
  onFilter,
  onSet,
}: {
  catalog: Catalog;
  filter: string;
  onFilter: (filter: string) => void;
  onSet: (code: string) => void;
}) {
  const owning = useOwning();
  const owned = useMemo(
    () => catalog.bySet(owning?.printings ?? []),
    [catalog, owning?.printings],
  );

  const sets = useMemo(() => {
    const wanted = filter.trim().toLowerCase();
    return (
      catalog
        .sets()
        .filter(({ set, printings }) => {
          if (printings === 0) return false;
          if (!wanted) return true;
          return (
            set[1].toLowerCase().includes(wanted) || set[0].includes(wanted)
          );
        })
        // Newest first, which puts an announced set at the top during spoilers.
        .sort((a, b) => b.set[3].localeCompare(a.set[3]))
    );
  }, [catalog, filter]);

  return (
    <>
      <input
        className="filter"
        type="search"
        value={filter}
        placeholder={`Filter ${sets.length.toLocaleString()} sets`}
        onChange={(event) => onFilter(event.target.value)}
      />
      <ul className="sets">
        {sets.map(({ set, printings }) => (
          <li key={set[0]}>
            <button
              type="button"
              className="link"
              onClick={() => onSet(set[0])}
            >
              {set[1]}
            </button>
            <span>
              {set[0].toUpperCase()} · {set[3].slice(0, 4)} ·{" "}
              {/* What is owned against what exists, once either is worth
                  comparing: an empty collection would read 0 of everything.
                  todo(settings): counting treatments as well as printings. */}
              {owned.get(set[0]) ? (
                <>
                  {owned.get(set[0])?.toLocaleString()} of{" "}
                  {printings.toLocaleString()}
                </>
              ) : (
                <>
                  {printings.toLocaleString()} printing
                  {printings === 1 ? "" : "s"}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Printings({
  catalog,
  code,
  onBack,
}: {
  catalog: Catalog;
  code: string;
  onBack: () => void;
}) {
  const printings = useMemo(() => catalog.setPrints(code), [catalog, code]);
  const name = printings[0]?.print.setName ?? code.toUpperCase();

  return (
    <>
      <p className="actions">
        <button type="button" onClick={onBack}>
          All sets
        </button>
        <span>
          {name} · {printings.length.toLocaleString()} printing
          {printings.length === 1 ? "" : "s"}
        </span>
      </p>
      <ol className="results">
        {printings.map(({ card, print }) => (
          <CardRow
            key={print.id}
            card={catalog.card(card)}
            catalog={catalog}
            print={print}
          />
        ))}
      </ol>
    </>
  );
}
