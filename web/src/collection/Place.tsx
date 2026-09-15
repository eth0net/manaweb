import { useMemo, useState } from "react";
import {
  appLanguage,
  type Card,
  type Catalog,
  cardName,
  image,
  type Print,
  words,
} from "../catalog";
import { Modal } from "../Modal";
import { describe, hasArt, Language } from "../Printing";
import { Printings } from "../Printings";
import { Link } from "../router";
import {
  CONDITIONS,
  type Holdings,
  NOTE,
  type Stack,
  shown,
  TAG,
  TAGS,
  unwritten,
} from "./cards";
import { type Containers, UNFILED } from "./containers";

const APP = appLanguage();

// What one place holds, a stack to a row, and where a stack is edited.
export function Place({
  catalog,
  containers,
  owning,
  place,
  name,
}: {
  catalog: Catalog | null;
  containers: Containers;
  owning: Holdings;
  // The container's at-uri, or null for what was never filed anywhere.
  place: string | null;
  name: string;
}) {
  const [filter, setFilter] = useState("");

  const filed = useMemo(
    () =>
      owning.stacks.filter((one) => (one.value.container ?? null) === place),
    [owning.stacks, place],
  );

  const found = useMemo(
    () => catalog?.resolve(filed.map((one) => one.value.scryfallId)),
    [catalog, filed],
  );

  const rows = useMemo(() => {
    const wanted = filter.trim().toLowerCase();
    return filed
      .map((one) => {
        const card = found?.get(one.value.scryfallId);
        return {
          one,
          card: card?.card,
          print: card?.print,
          // The id until the catalog loads, which is at least addressable.
          name: card
            ? cardName(card.card.name, card.print, APP).text
            : one.value.scryfallId,
        };
      })
      .filter((row) => !wanted || row.name.toLowerCase().includes(wanted))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filed, found, filter]);

  const total = filed.reduce((sum, one) => sum + shown(one), 0);

  return (
    <>
      <p className="actions">
        <Link className="link" to="/collection">
          ← Collection
        </Link>
        <span>
          {name} · {total.toLocaleString()} card{total === 1 ? "" : "s"}
        </span>
      </p>

      {filed.length > 0 && (
        <input
          className="filter"
          type="search"
          value={filter}
          placeholder={`Filter ${filed.length.toLocaleString()} stacks`}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}

      {filed.length === 0 ? (
        <p className="quiet">
          Nothing here yet. Point the destination at {name} and add a card.
        </p>
      ) : (
        <ol className="results">
          {rows.map((row) => (
            <Row
              key={row.one.uri}
              one={row.one}
              card={row.card}
              print={row.print}
              name={row.name}
              catalog={catalog}
              containers={containers}
              owning={owning}
            />
          ))}
        </ol>
      )}
    </>
  );
}

function Row({
  one,
  card,
  print,
  name,
  catalog,
  containers,
  owning,
}: {
  one: Stack;
  card: Card | undefined;
  print: Print | undefined;
  name: string;
  catalog: Catalog | null;
  containers: Containers;
  owning: Holdings;
}) {
  const { quantity } = one.value;
  const landing = one.waiting ?? 0;

  return (
    <li>
      <div className="card">
        {catalog && card && print && hasArt(print) && (
          <Printings
            card={card}
            catalog={catalog}
            name={name}
            start={print}
            trigger="art"
            label={
              <img src={image(print.id, "small")} alt="" loading="lazy" />
            }
          />
        )}
        <div>
          <h2>
            {name}
            {print && print.lang !== "en" && <Language code={print.lang} />}
            <span className="tag">{words(one.value.finish)}</span>
            {one.value.condition && (
              <span className="tag">{words(one.value.condition)}</span>
            )}
            {one.value.proxy && <span className="tag">proxy</span>}
            {landing > 0 && (
              <span className="tag">{landing.toLocaleString()} landing</span>
            )}
            {one.value.tags?.map((label) => (
              <span className="tag free" key={label}>
                {label}
              </span>
            ))}
          </h2>
          {print && <p className="print">{describe(print)}</p>}
          {one.value.note && <p className="note">{one.value.note}</p>}
          <div className="meta">
            {/* An import writes its cards whole and turns them into records
                over hours, and nothing addresses one until it is a record. */}
            {unwritten(one) ? (
              <span className="owned quiet">
                {shown(one).toLocaleString()} landing
              </span>
            ) : (
              <>
                <span className="adjust">
                  <button
                    type="button"
                    className="step"
                    aria-label="One fewer"
                    onClick={() =>
                      void owning.amend(one.uri, { quantity: quantity - 1 })
                    }
                  >
                    −
                  </button>
                  <span className="owned">{shown(one).toLocaleString()}</span>
                  <button
                    type="button"
                    className="step"
                    aria-label="One more"
                    onClick={() =>
                      void owning.amend(one.uri, { quantity: quantity + 1 })
                    }
                  >
                    +
                  </button>
                </span>
                <Edit
                  one={one}
                  name={name}
                  containers={containers}
                  owning={owning}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function Edit({
  one,
  name,
  containers,
  owning,
}: {
  one: Stack;
  name: string;
  containers: Containers;
  owning: Holdings;
}) {
  return (
    <Modal
      trigger="link"
      title={name}
      label="Edit"
      actions={
        <button
          type="button"
          onClick={() => void owning.amend(one.uri, { quantity: 0 })}
        >
          Remove
        </button>
      }
    >
      <Fields one={one} containers={containers} owning={owning} />
    </Modal>
  );
}

// Everything identity is made of bar the printing itself, so any of them can
// land these copies on a stack that already matches.
function Fields({
  one,
  containers,
  owning,
}: {
  one: Stack;
  containers: Containers;
  owning: Holdings;
}) {
  const { amend } = owning;
  const { uri, value } = one;
  // Typing is not a write, so the free text commits when it is left.
  const [tags, setTags] = useState((value.tags ?? []).join(", "));
  const [note, setNote] = useState(value.note ?? "");

  return (
    <>
      <p className="field">
        <label htmlFor={`place-${uri}`}>Place</label>
        <select
          id={`place-${uri}`}
          value={value.container ?? ""}
          onChange={(event) =>
            void amend(uri, { container: event.target.value || undefined })
          }
        >
          <option value="">{UNFILED.name}</option>
          {containers.held.map((into) => (
            <option key={into.uri} value={into.uri}>
              {into.value.name}
            </option>
          ))}
        </select>
      </p>

      <p className="field">
        <label htmlFor={`grade-${uri}`}>Condition</label>
        <select
          id={`grade-${uri}`}
          value={value.condition ?? ""}
          onChange={(event) =>
            void amend(uri, { condition: event.target.value || undefined })
          }
        >
          <option value="">Ungraded</option>
          {CONDITIONS.map((grade) => (
            <option key={grade} value={grade}>
              {words(grade)}
            </option>
          ))}
        </select>
      </p>

      <p className="field">
        <label htmlFor={`tags-${uri}`}>Tags</label>
        <input
          id={`tags-${uri}`}
          type="text"
          value={tags}
          placeholder="altered, misprint, signed"
          onChange={(event) => setTags(event.target.value)}
          onBlur={() => void amend(uri, { tags: labels(tags) })}
        />
      </p>

      <p className="field">
        <label htmlFor={`note-${uri}`}>Note</label>
        <textarea
          id={`note-${uri}`}
          rows={2}
          maxLength={NOTE}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => void amend(uri, { note: note.trim() || undefined })}
        />
      </p>

      <p className="check">
        <input
          id={`proxy-${uri}`}
          type="checkbox"
          checked={value.proxy ?? false}
          onChange={(event) =>
            void amend(uri, { proxy: event.target.checked || undefined })
          }
        />
        <label htmlFor={`proxy-${uri}`}>Proxy</label>
      </p>

      <p className="quiet">
        Editing any of these can merge these copies into a stack that already
        matches.
      </p>
    </>
  );
}

// Comma-separated in the field, a list in the record.
function labels(text: string): string[] | undefined {
  const tags = text
    .split(",")
    .map((one) => one.trim().slice(0, TAG))
    .filter(Boolean)
    .slice(0, TAGS);
  return tags.length > 0 ? tags : undefined;
}
