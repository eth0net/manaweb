import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CardRow } from "./CardRow";
import type { Catalog, SetRow } from "./catalog";
import { matches, parse } from "./catalog/query";
import { normalize } from "./catalog/search";
import { useOwning } from "./collection/context";
import { Colors } from "./filters/Colors";
import { More } from "./filters/Filters";
import { Modes } from "./Nav";
import { amend, useSettings } from "./router";

export const SETS = "/cards/sets";

export type Listed = { set: SetRow; printings: number };

// Browsing answers "what did this set hold", which a name you have to know
// first cannot. Searching is the other half, and its own place.
export function SetView({
  catalog,
  tools,
}: {
  catalog: Catalog;
  tools?: ReactNode;
}) {
  const settings = useSettings();
  const code = settings.get("set") ?? "";
  const filter = settings.get("find") ?? "";
  const all = useSets(catalog);
  const sets = useMemo(() => narrow(all, filter), [all, filter]);

  if (code) {
    return (
      <Printings catalog={catalog} code={code} sets={all} tools={tools} />
    );
  }

  return (
    <>
      <Modes path={SETS} />
      <div className="tools">
        <input
          type="search"
          value={filter}
          placeholder={`Filter ${sets.length.toLocaleString()} sets`}
          onChange={(event) => amend({ find: event.target.value })}
        />
        {tools}
      </div>
      <SetList
        catalog={catalog}
        sets={sets}
        onPick={(one) => amend({ set: one }, true)}
      />
    </>
  );
}

// Every printing a set holds, in collector number order, narrowed by the same
// tools a search across the catalog is.
function Printings({
  catalog,
  code,
  sets,
  tools,
}: {
  catalog: Catalog;
  code: string;
  sets: Listed[];
  tools?: ReactNode;
}) {
  const settings = useSettings();
  const query = settings.get("q") ?? "";
  const [text, setText] = useState(query);
  useEffect(() => setText(query), [query]);

  const push = (next: string) => {
    setText(next);
    amend({ q: next });
  };

  const codes = useMemo(() => [code], [code]);
  const printings = useMemo(() => catalog.setPrints(codes), [catalog, codes]);

  // A set is a few hundred rows, so the pile is walked rather than indexed,
  // and every row is one printing rather than a card standing for its run.
  const parsed = useMemo(() => parse(query), [query]);
  const shown = useMemo(
    () =>
      printings.filter(({ card, print }) => {
        const one = catalog.card(card);
        if (!matches(parsed, one, [print])) return false;
        return !parsed.text || named(one.name, parsed.text);
      }),
    [catalog, printings, parsed],
  );

  return (
    <>
      <Modes
        path={SETS}
        crumb={`${label(sets, codes)} · ${count(shown.length, printings.length)}`}
      />
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
          placeholder="Search this set"
        />
        <button type="submit">Search</button>
        <Colors text={text} onText={push} />
        <More catalog={catalog} text={text} onText={push} />
        {tools}
      </form>

      {parsed.missing.length > 0 && (
        <p className="warn">
          Not on this device: {parsed.missing.join(", ")}.
        </p>
      )}

      {shown.length === 0 ? (
        <p>Nothing in {label(sets, codes)} matches.</p>
      ) : (
        <ol className="results">
          {shown.map(({ card, print }) => (
            <CardRow
              key={print.id}
              card={catalog.card(card)}
              catalog={catalog}
              print={print}
            />
          ))}
        </ol>
      )}
    </>
  );
}

// Ranking is for a catalog-wide scan; inside one set a name either reads the
// same or it doesn't.
function named(name: string, wanted: string): boolean {
  return normalize(name).includes(normalize(wanted));
}

// What is left against what the set holds, the whole of it needing no compare.
function count(shown: number, held: number): string {
  const printings = `${held.toLocaleString()} printing${held === 1 ? "" : "s"}`;
  return shown === held
    ? printings
    : `${shown.toLocaleString()} of ${printings}`;
}

// Every set holding a paper printing, newest first, which puts an announced
// set at the top during spoilers.
export function useSets(catalog: Catalog): Listed[] {
  return useMemo(
    () =>
      catalog
        .sets()
        .filter(({ printings }) => printings > 0)
        .sort((a, b) => b.set[3].localeCompare(a.set[3])),
    [catalog],
  );
}

// By name or by code, so "inv" finds Invasion and "lea" finds Alpha.
export function narrow(sets: Listed[], filter: string): Listed[] {
  const wanted = filter.trim().toLowerCase();
  if (!wanted) return sets;
  return sets.filter(
    ({ set }) =>
      set[1].toLowerCase().includes(wanted) || set[0].includes(wanted),
  );
}

// One set is worth naming; a handful is only worth counting.
export function label(sets: Listed[], chosen: string[]): string {
  if (chosen.length === 0) return "All sets";
  if (chosen.length > 1) return `${chosen.length} sets`;
  const only = chosen[0] as string;
  return sets.find(({ set }) => set[0] === only)?.set[1] ?? only.toUpperCase();
}

// Browsed or picked from, which is the same list either way: what one press
// does is the caller's.
export function SetList({
  catalog,
  sets,
  chosen,
  onPick,
}: {
  catalog: Catalog;
  sets: Listed[];
  // Absent where a press is a jump rather than a toggle, which is what tells
  // the two lists apart to anything reading them aloud.
  chosen?: string[];
  onPick: (code: string) => void;
}) {
  const owning = useOwning();
  const owned = useMemo(
    () => catalog.bySet(owning?.printings ?? []),
    [catalog, owning?.printings],
  );

  return (
    <ul className="sets">
      {sets.map(({ set, printings }) => (
        <li key={set[0]}>
          <button
            type="button"
            className="link"
            aria-pressed={chosen?.includes(set[0])}
            onClick={() => onPick(set[0])}
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
  );
}
