import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useMemo, useState } from "react";
import type { Holdings } from "../collection/cards";
import { Link } from "../router";
import { detect, FORMATS, type Format } from "./formats";
import { plan, type Weight, weigh } from "./plan";
import { header, type Read, read } from "./read";
import { digest, type Receipt, useReceipts } from "./receipt";
import {
  begin,
  carryOn,
  drop,
  HOURLY,
  halt,
  type State,
  useImport,
} from "./runner";

export const IMPORT = "/collection/import";

// The lexicon's ceiling on a remembered file name.
const FILE = 255;

// A file read and identified, which is everything the receipt for it needs.
type Taken = { format: Format; got: Read; file: string; digest: string };

const NAMES = FORMATS.map((one) => one.name).join(", ");

// An import outlives the page that started it, so it reports from wherever you
// are — and a stopped one says so loudest, being the one nothing else would
// ever mention again.
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
  if (state.at === "running") return `Importing ${done} of ${total} records`;
  return `Import stopped at ${done} of ${total} records`;
}

// A collection arriving from somewhere else, and the one point at which the
// app asks where it is all going to live.
export function Import({
  session,
  owning,
}: {
  session: OAuthSession | null;
  owning: Holdings;
}) {
  const [found, setFound] = useState<Taken | null>(null);
  const [problem, setProblem] = useState("");
  const state = useImport();
  const taken = useReceipts(session);

  const steps = useMemo(
    () =>
      found && owning.ready
        ? plan(found.got.stacks, owning.stacks, new Date().toISOString())
        : null,
    [found, owning.ready, owning.stacks],
  );

  const weight = useMemo(
    () => (steps ? weigh(steps, owning.stacks) : null),
    [steps, owning.stacks],
  );

  // Cards bought since an import still plan as new, so the arithmetic below
  // stops recognizing a file the moment the collection moves on. This does not.
  const already =
    found && taken.find((one) => one.value.digest === found.digest);

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

    const got = read(text, format);
    setFound({
      format,
      got,
      file: file.name.slice(0, FILE),
      digest: await digest(got.stacks),
    });
  }

  function start(taking: Taken, weight: Weight) {
    void begin(steps ?? [], {
      source: taking.format.name,
      file: taking.file,
      digest: taking.digest,
      cards: weight.adding,
      stacks: weight.records,
      createdAt: new Date().toISOString(),
    });
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
            Read as {found.format.name}, as {counts(weight)}, which takes{" "}
            {about(weight.records)} at the rate a PDS allows.
          </p>

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

          <button type="button" onClick={() => start(found, weight)}>
            Add {weight.adding.toLocaleString()} card
            {weight.adding === 1 ? "" : "s"}
            {already || again(weight) ? " anyway" : ""}
          </button>
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
              ? `Waiting on the write budget until ${clock(state.due)}. It carries on wherever you go in the app, and picks up here next time if you close it.`
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

// What an import is quoted at before one has run. What it takes is whatever the
// PDS turns out to allow.
function about(records: number): string {
  const minutes = Math.round((records / HOURLY) * 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `about ${minutes} minutes`;
  return `about ${Math.round(minutes / 60)} hours`;
}
