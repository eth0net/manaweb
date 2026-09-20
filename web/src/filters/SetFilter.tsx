import { useMemo } from "react";
import type { Catalog } from "../catalog";
import { Modal } from "../Modal";
import { amend, useSettings } from "../router";
import { label, narrow, SetList, useSets } from "../Sets";
import { KEY, read, write } from "../terms";

// Which sets the search is narrowed to, written into the query as the `s:`
// terms it stands for.
export function SetFilter({
  catalog,
  text,
  onText,
}: {
  catalog: Catalog;
  text: string;
  onText: (next: string) => void;
}) {
  const settings = useSettings();
  const filter = settings.get("find") ?? "";
  const all = useSets(catalog);
  const sets = useMemo(() => narrow(all, filter), [all, filter]);
  const chosen = useMemo(() => read(text, KEY.set).values, [text]);

  // Picked first, or unpicking one means finding it again among 989.
  const ordered = useMemo(() => {
    if (chosen.length === 0) return sets;
    const picked = (one: string) => chosen.includes(one);
    return [
      ...sets.filter(({ set }) => picked(set[0])),
      ...sets.filter(({ set }) => !picked(set[0])),
    ];
  }, [sets, chosen]);

  return (
    <Modal
      trigger="tool"
      title="Sets"
      label={
        <>
          {label(all, chosen)}
          <span className="quiet" aria-hidden="true">
            ▾
          </span>
        </>
      }
      actions={
        chosen.length > 0 && (
          <button
            type="button"
            onClick={() => onText(write(text, KEY.set, []))}
          >
            All sets
          </button>
        )
      }
    >
      <input
        className="filter"
        type="search"
        value={filter}
        placeholder={`Filter ${sets.length.toLocaleString()} sets`}
        onChange={(event) => amend({ find: event.target.value })}
      />
      <SetList
        catalog={catalog}
        sets={ordered}
        chosen={chosen}
        onPick={(code) =>
          onText(
            write(
              text,
              KEY.set,
              chosen.includes(code)
                ? chosen.filter((one) => one !== code)
                : [...chosen, code],
            ),
          )
        }
      />
    </Modal>
  );
}
