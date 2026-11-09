import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useMemo, useState } from "react";
import type { Catalog } from "../catalog";
import {
  clip,
  collapse,
  type Holdings,
  type Owned,
} from "../collection/cards";
import { Link, navigate } from "../router";
import { REVIEW } from "../scan/Scan";
import { copies } from "../scan/scratch";
import type { Scratch } from "../scan/store";
import { asPaid, detect, FORMATS, type Format } from "./formats";
import { plan, type Weight, weigh } from "./plan";
import { header, type Read, read } from "./read";
import { digest, type Receipt, useReceipts } from "./receipt";
import { taken } from "./review";
import { carryOn, drop, HOURLY, halt, type State, useImport } from "./runner";

export const IMPORT = "/collection/import";

// The review a file goes through, under the import that opened it rather
// than beside the camera: it is the same list and not the same screen.
export const REVIEWING = `${IMPORT}/review`;

// The lexicon's ceiling on a remembered file name, in bytes.
const FILE = 255;

// A file read and identified, which is everything the receipt for it needs.
// The text stays so that reading it the other way costs no second trip.
type Taken = {
  format: Format;
  paid: boolean;
  got: Read;
  // The file's rows as records, which is fewer of them: a bulk common repeats
  // down a file and goes to the repo once.
  stacks: Owned[];
  file: string;
  digest: string;
  text: string;
};

const NAMES = FORMATS.map((one) => one.name).join(", ");

// Reports from wherever you are, a stopped one loudest: it is the one nothing
// else would ever mention again.
export function ImportStatus({ path }: { path: string }) {
  const state = useImport();
  if (state.at === "none" || path === IMPORT) return null;

  return (
    <p className="destination">
      <Link className="link" to={IMPORT}>
        {say(state)}
      </Link>
    </p>
  );
}

function say(state: Exclude<State, { at: "none" }>): string {
  const total = state.total.toLocaleString();
  if (state.at === "done") return `Import finished, ${total} records`;

  const done = state.done.toLocaleString();
  if (state.at === "uploading") return `Uploading ${total} records`;
  if (state.at === "running") return `Importing ${done} of ${total} records`;
  return `Import stopped at ${done} of ${total} records`;
}

// The way back into a file still being gone through, which is otherwise two
// presses away and named nowhere.
export function ReviewStatus({
  path,
  scratch,
}: {
  path: string;
  scratch: Scratch;
}) {
  // Rows rather than cards: a file with every row struck off still holds the
  // place, and saying nothing about it leaves the next one refused for a
  // reason nothing on the screen gives.
  const mine = scratch.source.at === "file" ? scratch.list : [];
  if (mine.length === 0 || path === REVIEWING) return null;
  const held = copies(mine);

  return (
    <p className="destination">
      <Link className="link" to={REVIEWING}>
        {held === 0
          ? "A file is open, with every row struck off"
          : `${held.toLocaleString()} card${held === 1 ? "" : "s"} waiting to be kept`}
      </Link>
    </p>
  );
}

// A collection arriving from somewhere else, and the one point at which the
// app asks where it is all going to live.
export function Import({
  session,
  owning,
  catalog,
  scratch,
  container,
  place,
}: {
  session: OAuthSession | null;
  owning: Holdings;
  catalog: Catalog | null;
  scratch: Scratch;
  // Where the review will file them, which decides what joins what.
  container: string | null;
  // That container by name. The arithmetic below follows a choice made on
  // another screen, so the screen showing it has to say which.
  place?: string | null;
}) {
  const [found, setFound] = useState<Taken | null>(null);
  const [problem, setProblem] = useState("");
  const state = useImport();
  const receipts = useReceipts(session);

  // Not while a job is running: the file stays here until it is discarded,
  // and `owning.stacks` moves with every batch the drain lands.
  const steps = useMemo(
    () =>
      found && owning.ready && state.at === "none"
        ? plan(
            container
              ? found.stacks.map((one) => ({ ...one, container }))
              : found.stacks,
            owning.stacks,
            new Date().toISOString(),
          )
        : null,
    [container, found, owning.ready, owning.stacks, state.at],
  );

  const weight = useMemo(
    () => (steps ? weigh(steps, owning.stacks) : null),
    [steps, owning.stacks],
  );

  // Cards bought since an import still plan as new, so the arithmetic below
  // stops recognizing a file the moment the collection moves on. This does not.
  const already =
    found && receipts.find((one) => one.value.digest === found.digest);

  async function take(file: File | null) {
    setFound(null);
    setProblem("");
    if (!file) return;

    const text = await file.text();
    const format = detect(header(text));
    if (!format) {
      setProblem(`Not a collection this reads. It knows ${NAMES}.`);
      return;
    }

    // Needed whatever the file names its cards by: the review it goes to
    // draws every row out of the catalog.
    if (!catalog) {
      setProblem("The catalog has not loaded, and reviewing a file needs it.");
      return;
    }

    setFound(await reading(text, format, false, clip(file.name, FILE)));
  }

  async function reading(
    text: string,
    format: Format,
    paid: boolean,
    file: string,
  ): Promise<Taken> {
    const got = read(
      text,
      (paid ? asPaid(format) : null) ?? format,
      new Date().toISOString(),
      catalog ? (keys) => catalog.locate(keys) : undefined,
      catalog
        ? (ids) =>
            new Map(
              [...catalog.resolve(ids)].map(([id, { print }]) => [
                id,
                print.finishes,
              ]),
            )
        : undefined,
    );
    const stacks = collapse(got.rows.map(({ one }) => one));
    return {
      format,
      paid,
      got,
      stacks,
      file,
      text,
      digest: await digest(stacks),
    };
  }

  // Rows rather than stacks, and in the file's own order: what joins what is
  // settled in the review and again when the card is written.
  function review(taking: Taken) {
    scratch.begin(
      {
        at: "file",
        format: taking.format.name,
        file: taking.file,
        digest: taking.digest,
      },
      taken(taking.got.rows),
    );
    navigate(REVIEWING);
  }

  // The file goes with the job. Planned against a collection that now holds
  // everything just written, the same rows would merge into themselves.
  function forget() {
    setFound(null);
    setProblem("");
    void drop();
  }

  if (!session) return <Gate />;

  if (state.at !== "none") {
    return <Job state={state} forget={forget} />;
  }

  return (
    <>
      <p>
        A CSV exported from another tracker. It is read here, and nothing is
        written until you say so.
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => void take(event.target.files?.[0] ?? null)}
      />

      {problem && <p className="warn">{problem}</p>}

      {found && steps && weight && (
        <>
          <p className="tally">
            {weight.adding.toLocaleString()} card
            {weight.adding === 1 ? "" : "s"}
          </p>
          <p className="quiet">
            Read as {found.format.name}, as {counts(weight)}
            {place ? `, filed under ${place}` : ""}. Keeping the list sends the
            file to your repository in seconds; becoming cards there takes{" "}
            {about(found.stacks.length)} of write budget, and carries on
            whenever the app is open.
          </p>

          {asPaid(found.format) && (
            <p className="quiet">
              <label>
                {found.format.binding.marketValue} is{" "}
                <select
                  value={found.paid ? "paid" : "worth"}
                  onChange={(event) =>
                    void reading(
                      found.text,
                      found.format,
                      event.target.value === "paid",
                      found.file,
                    ).then(setFound)
                  }
                >
                  <option value="worth">what a copy was worth</option>
                  <option value="paid">what you paid</option>
                </select>
              </label>
            </p>
          )}

          {already && <p className="warn">{recalled(already.value)}</p>}

          {weight.before > 0 && (
            <p className={again(weight) ? "warn" : "quiet"}>{lands(weight)}</p>
          )}

          {found.got.skipped.length > 0 && (
            <ul className="skipped">
              {found.got.skipped.map(({ line, reason }) => (
                <li key={line}>
                  Line {line}: {reason}
                </li>
              ))}
            </ul>
          )}

          {!scratch.ready ? (
            // Empty and unread look alike, and reading a file in over a list
            // nobody has seen is the one thing this screen must not do.
            <p className="quiet">Looking for a list already open…</p>
          ) : scratch.list.length > 0 ? (
            // One list to a device, and the one held is the only copy of
            // whatever is in it — `docs/scanner.md`.
            <p className="warn">
              A list is already open.{" "}
              <Link
                className="link"
                to={scratch.source.at === "file" ? REVIEWING : REVIEW}
              >
                Keep or clear it
              </Link>{" "}
              before reading this file in.
            </p>
          ) : (
            <button type="button" onClick={() => review(found)}>
              Review {found.got.rows.length.toLocaleString()} row
              {found.got.rows.length === 1 ? "" : "s"}
            </button>
          )}
        </>
      )}
    </>
  );
}

// An import under way, or one waiting to be picked back up.
function Job({
  state,
  forget,
}: {
  state: Exclude<State, { at: "none" }>;
  forget: () => void;
}) {
  if (state.at === "done") {
    return (
      <>
        <p className="tally">
          {state.total.toLocaleString()} records written.
        </p>
        <button type="button" onClick={forget}>
          Import another
        </button>
      </>
    );
  }

  if (state.at === "uploading") {
    return (
      <>
        <p className="tally">Sending {state.total.toLocaleString()} records</p>
        <p className="quiet">
          Going to your repository whole. Nothing is a card yet, and closing
          this before it finishes is the one thing that loses the file.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="tally">
        {state.done.toLocaleString()} of {state.total.toLocaleString()} records
      </p>

      {state.at === "running" && (
        <p className="quiet">
          {state.quiet
            ? "Your PDS has stopped answering. Nothing is lost and it keeps trying."
            : state.due > Date.now()
              ? `Waiting on the write budget until ${clock(state.due)}. Your repository already holds the file, so this is it becoming cards — on any device you sign in to, whether or not it is this one.`
              : "Writing."}
        </p>
      )}

      {state.at === "failed" && <p className="warn">{state.why}</p>}

      {state.at === "running" ? (
        <button type="button" onClick={() => void halt()}>
          Stop
        </button>
      ) : (
        <button type="button" onClick={() => void carryOn()}>
          Carry on
        </button>
      )}
      <button type="button" onClick={forget}>
        Discard
      </button>
    </>
  );
}

// todo(local): a collection held on the device alone, which is the answer for
// anyone who wants neither an account nor a world-readable inventory.
function Gate() {
  return (
    <>
      <p>Importing needs an account.</p>
      <p className="quiet">
        Cards are written to your own repository rather than to us, which is
        what makes them yours to take elsewhere. Signed out there is nowhere to
        put them, and a browser tab is not somewhere ten thousand cards should
        be trusted to.
      </p>
      <p className="quiet">
        Whatever lands there can be read by anyone who goes looking. Nothing on
        atproto is private yet, so a collection is a public one.
      </p>
    </>
  );
}

function counts(weight: Weight): string {
  const fresh = `${weight.fresh.toLocaleString()} new stacks`;
  const joined = `${weight.joined.toLocaleString()} joining ones you hold`;
  if (weight.joined === 0) return fresh;
  if (weight.fresh === 0) {
    return `${weight.records.toLocaleString()} stacks, all joining ones you hold`;
  }
  return `${fresh} and ${joined}`;
}

// A file that brings nothing new, which is the shape a second import of one
// export takes.
function again(weight: Weight): boolean {
  return weight.before > 0 && weight.fresh === 0;
}

// A file taken before, named and dated, which is a fact rather than a shape
// the numbers happen to have.
function recalled(one: Receipt): string {
  const when = new Date(one.createdAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
  });
  const what = one.file || "A file naming these exact cards";
  return `${what} was imported on ${when}.`;
}

// Arithmetic is the whole guard: a second copy of one export and a second
// identical precon plan the same way, and only the owner knows which this is.
function lands(weight: Weight): string {
  const from = weight.before.toLocaleString();
  const to = weight.after.toLocaleString();
  if (!again(weight))
    return `Your collection goes from ${from} to ${to} cards.`;
  return `Nothing here is new. Every stack joins one you already hold, taking the collection from ${from} to ${to} cards, which is also what importing the same file twice looks like.`;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The quote `HOURLY` carries, put into words. What it takes is whatever the
// PDS turns out to allow.
function about(records: number): string {
  const minutes = Math.round((records / HOURLY) * 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `about ${minutes} minutes`;
  return `about ${Math.round(minutes / 60)} hours`;
}
