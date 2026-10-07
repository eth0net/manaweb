import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useMemo, useState } from "react";
import type { Catalog } from "../catalog";
import { type Holdings, shown } from "../collection/cards";
import { type Containers, UNFILED } from "../collection/containers";
import type { Field } from "../import/formats";
import { FORMATS, MANABOX } from "../import/formats";
import { useListed } from "../import/runner";
import { write } from "./csv";
import { rows, type Written } from "./rows";
import { ALL, named, plain, within } from "./scope";

export const EXPORT = "/collection/export";

// How long the file stays reachable after the press.
const KEEP = 60_000;

// What a column the format lacks would have carried, in the app's own words.
const WORDS: Partial<Record<Field, string>> = {
  container: "where cards are filed",
  updatedAt: "when a stack last changed",
  note: "notes",
  proxy: "which cards are proxies",
  tags: "tags",
  price: "what you paid",
};

// Which file to ask for, since the choice is what reads it rather than what
// is in it. A format nobody described says nothing rather than breaking.
const FOR: Record<string, string> = {
  ManaBox: "what another tracker will read",
  Manaweb: "every column a record holds",
};

// Your collection as a file another tracker reads, which is the half of
// owning your data that having an account does not give you.
export function Export({
  session,
  owning,
  catalog,
  containers,
}: {
  session: OAuthSession | null;
  owning: Holdings;
  catalog: Catalog | null;
  containers: Containers;
}) {
  const [format, setFormat] = useState(MANABOX);
  const [scope, setScope] = useState(ALL);
  // Off by default: the file says what the card is until somebody decides
  // they would rather it said what the tracker will take.
  const [english, setEnglish] = useState(false);
  // An import puts cards in the repo hours before they are records, and a
  // listing that has not come back looks exactly like one holding nothing.
  const counted = useListed();

  const places = useMemo(
    () => new Map(containers.held.map((one) => [one.uri, one.value.name])),
    [containers.held],
  );

  const chosen = useMemo(
    () => within(owning.stacks, scope),
    [owning.stacks, scope],
  );

  const ready = owning.fresh && counted;
  const written = useMemo(
    () =>
      catalog && ready
        ? rows(chosen, format, (ids) => catalog.resolve(ids), {
            places,
            english,
          })
        : null,
    [catalog, ready, chosen, format, places, english],
  );

  const cards = chosen.reduce((sum, one) => sum + shown(one), 0);

  if (!session) {
    return <p className="quiet">Sign in to export what you own.</p>;
  }

  return (
    <>
      <p>
        A CSV of what you own, read here and written on this device. Nothing
        leaves your repository to make it.
      </p>

      <form className="query" onSubmit={(event) => event.preventDefault()}>
        <select
          value={scope}
          aria-label="What to export"
          onChange={(event) => setScope(event.target.value)}
        >
          <option value={ALL}>Everything</option>
          <option value={UNFILED.key}>{UNFILED.name}</option>
          {containers.held.map((one) => (
            <option key={one.uri} value={one.uri}>
              {one.value.name}
            </option>
          ))}
        </select>

        {FORMATS.length > 1 && (
          <select
            value={format.name}
            aria-label="Which format"
            onChange={(event) =>
              setFormat(
                FORMATS.find((one) => one.name === event.target.value) ??
                  MANABOX,
              )
            }
          >
            {FORMATS.map((one) => (
              <option key={one.name} value={one.name}>
                {one.name}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          disabled={!written || cards === 0}
          onClick={() =>
            written && save(written, format.name, named(scope, places))
          }
        >
          Download
        </button>
      </form>

      <p className="tally">
        {cards.toLocaleString()} card{cards === 1 ? "" : "s"}
        {FOR[format.name] && (
          <span className="quiet"> · {FOR[format.name]}</span>
        )}
      </p>

      {!catalog ? (
        <p className="warn">
          The catalog that names your cards is not loaded, so there is nothing
          to write their names from.
        </p>
      ) : owning.error ? (
        <p className="warn">
          Your collection did not come back: {owning.error}
        </p>
      ) : !ready ? (
        <p className="quiet">Reading your collection…</p>
      ) : (
        written && (
          <>
            <Losses written={written} format={format.name} />
            {written.refused > 0 && (
              <p className="warn">
                <label>
                  <input
                    type="checkbox"
                    checked={english}
                    onChange={(event) => setEnglish(event.target.checked)}
                  />{" "}
                  {written.refused.toLocaleString()} card
                  {written.refused === 1 ? "" : "s"} in a language{" "}
                  {format.name} will not import. Say English instead, which is
                  what their own export says of those printings.
                </label>
              </p>
            )}
          </>
        )
      )}
    </>
  );
}

// A list with the verb that agrees with it, which is why this is not a join.
function said(fields: Field[]): string {
  const words = fields.map((field) => WORDS[field] ?? field);
  const last = words.pop() ?? "";
  const all = words.length > 0 ? `${words.join(", ")} and ${last}` : last;
  return `${all} ${fields.length === 1 ? "is" : "are"}`;
}

// What the file will not say, while there is still a chance not to write it.
function Losses({ written, format }: { written: Written; format: string }) {
  const lost = written.dropped
    .map((field) => WORDS[field] ?? field)
    .join(", ");

  return (
    <>
      <p className="quiet">
        {(written.rows.length - 1).toLocaleString()} rows, as {format}.
      </p>
      {lost && (
        <p className="warn">
          A {format} file has no column for {lost}, so this one says nothing
          about {written.dropped.length === 1 ? "it" : "them"}.
        </p>
      )}
      {written.unnamed > 0 && (
        <p className="warn">
          {written.unnamed.toLocaleString()} card
          {written.unnamed === 1 ? "" : "s"} the catalog does not know, so only
          the Scryfall id names {written.unnamed === 1 ? "it" : "them"}.
        </p>
      )}
      {written.unread.length > 0 && (
        <p className="warn">
          {said(written.unread)} written here, and reading this file back would
          not restore {written.unread.length === 1 ? "it" : "them"}.
        </p>
      )}
      {written.unkept > 0 && (
        <p className="warn">
          {written.unkept.toLocaleString()} card
          {written.unkept === 1 ? "" : "s"} say something a row carries and a
          read makes nothing of — a tag holding a comma, or a figure with no
          currency beside it.
        </p>
      )}
      {written.unspent > 0 && (
        <p className="warn">
          {written.unspent.toLocaleString()} purchase
          {written.unspent === 1 ? "" : "s"} of copies you no longer hold, so
          no row says what you paid for {written.unspent === 1 ? "it" : "them"}{" "}
          or when.
        </p>
      )}
      {written.unspelled > 0 && (
        <p className="warn">
          {written.unspelled.toLocaleString()} card
          {written.unspelled === 1 ? "" : "s"} in a finish {format} has no word
          for, which {written.unspelled === 1 ? "that row" : "those rows"} will
          not read back as.
        </p>
      )}
    </>
  );
}

function save(written: Written, format: string, scope: string): void {
  const file = new Blob([write(written.rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(file);
  const day = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");

  link.href = url;
  link.download = `manaweb-${plain(scope)}-${plain(format)}-${day}.csv`;
  // In the document, and the blob kept well past the press: WebKit cancels a
  // download whose URL is revoked before it has committed, and says nothing.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), KEEP);
}
