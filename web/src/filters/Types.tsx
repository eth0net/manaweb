import { useMemo, useState } from "react";
import type { Catalog } from "../catalog";
import { Modal } from "../Modal";
import { compose, join, KEY, read, remove } from "../terms";

// Closed sets the rules own, so they are listed rather than scanned.
const SUPER = ["Basic", "Legendary", "Snow", "World"];

const TYPES = [
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Instant",
  "Kindred",
  "Land",
  "Planeswalker",
  "Sorcery",
  "Spacecraft",
];

// Every `t:` term is one word, so which control holds which value is read off
// the word rather than kept beside the query.
function sort(values: string[], subtypes: Set<string>) {
  const is = (list: string[]) => (one: string) =>
    list.some((each) => each.toLowerCase() === one.toLowerCase());

  return {
    supers: values.filter(is(SUPER)),
    types: values.filter(is(TYPES)),
    subs: values.filter((one) => subtypes.has(cased(one))),
  };
}

function cased(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Only the subtypes carry the any-or-all question, the other two being an
// `and` however they are asked — see `docs/search.md`.
export function Types({
  catalog,
  text,
  onText,
}: {
  catalog: Catalog;
  text: string;
  onText: (next: string) => void;
}) {
  const subtypes = useMemo(() => catalog.subtypes(), [catalog]);
  const known = useMemo(() => new Set(subtypes), [subtypes]);
  const held = read(text, KEY.type);
  const { supers, types, subs } = sort(held.values, known);
  const [all, setAll] = useState(false);

  // The three share one key, so the run is cut once and composed whole: a
  // second write would take back the terms the first had just put down.
  const rebuild = (
    changed: Partial<{ supers: string[]; types: string[]; subs: string[] }>,
    every = all,
  ) => {
    const now = { supers, types, subs, ...changed };
    return join(
      remove(text, KEY.type),
      compose(KEY.type, [...now.supers, ...now.types], { all: true }),
      compose(KEY.type, now.subs, { all: every }),
    );
  };

  const rewrite = (
    changed: Partial<{ supers: string[]; types: string[]; subs: string[] }>,
  ) => onText(rebuild(changed));

  return (
    <>
      <h3>Types</h3>
      <p className="actions">
        <select
          value={supers[0] ?? ""}
          aria-label="Supertype"
          onChange={(event) =>
            rewrite({ supers: event.target.value ? [event.target.value] : [] })
          }
        >
          <option value="">Any supertype</option>
          {SUPER.map((one) => (
            <option key={one} value={one.toLowerCase()}>
              {one}
            </option>
          ))}
        </select>
        <select
          value={types[0] ?? ""}
          aria-label="Type"
          onChange={(event) =>
            rewrite({ types: event.target.value ? [event.target.value] : [] })
          }
        >
          <option value="">Any type</option>
          {TYPES.map((one) => (
            <option key={one} value={one.toLowerCase()}>
              {one}
            </option>
          ))}
        </select>
      </p>

      <p className="actions">
        <Subtypes
          subtypes={subtypes}
          chosen={subs}
          onChoose={(next) => rewrite({ subs: next })}
        />
        <select
          value={all ? "all" : "any"}
          aria-label="How subtypes match"
          disabled={subs.length < 2}
          onChange={(event) => {
            const every = event.target.value === "all";
            setAll(every);
            onText(rebuild({}, every));
          }}
        >
          <option value="any">Any of them</option>
          <option value="all">All of them</option>
        </select>
      </p>
    </>
  );
}

// Open-ended and long, so it is filtered rather than listed in a menu.
function Subtypes({
  subtypes,
  chosen,
  onChoose,
}: {
  subtypes: string[];
  chosen: string[];
  onChoose: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const wanted = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    const picked = (one: string) =>
      chosen.some((each) => each.toLowerCase() === one.toLowerCase());
    const matching = subtypes.filter(
      (one) => !wanted || one.toLowerCase().includes(wanted),
    );
    return [
      ...matching.filter(picked),
      ...matching.filter((one) => !picked(one)),
    ];
  }, [subtypes, chosen, wanted]);

  return (
    <Modal
      trigger="tool"
      title="Subtypes"
      label={
        <>
          {chosen.length === 0
            ? "Any subtype"
            : chosen.length === 1
              ? cased(chosen[0] as string)
              : `${chosen.length} subtypes`}
          <span className="quiet" aria-hidden="true">
            ▾
          </span>
        </>
      }
      actions={
        chosen.length > 0 && (
          <button type="button" onClick={() => onChoose([])}>
            Any subtype
          </button>
        )
      }
    >
      <input
        className="filter"
        type="search"
        value={filter}
        placeholder={`Filter ${subtypes.length.toLocaleString()} subtypes`}
        onChange={(event) => setFilter(event.target.value)}
      />
      <ul className="sets">
        {shown.map((one) => {
          const on = chosen.some(
            (each) => each.toLowerCase() === one.toLowerCase(),
          );
          return (
            <li key={one}>
              <button
                type="button"
                className="link"
                aria-pressed={on}
                onClick={() =>
                  onChoose(
                    on
                      ? chosen.filter(
                          (each) => each.toLowerCase() !== one.toLowerCase(),
                        )
                      : [...chosen, one.toLowerCase()],
                  )
                }
              >
                {one}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
