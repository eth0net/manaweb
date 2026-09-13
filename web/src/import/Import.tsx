import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useMemo, useState } from "react";
import type { Holdings } from "../collection/cards";
import { BATCH } from "../oauth/repo";
import { detect, FORMATS, type Format } from "./formats";
import { SPACING, type State, useImport } from "./job";
import { cards, plan, type Step } from "./plan";
import { header, type Read, read } from "./read";

export const IMPORT = "/collection/import";

const NAMES = FORMATS.map((one) => one.name).join(", ");

// A collection arriving from somewhere else, and the one point at which the
// app asks where it is all going to live.
export function Import({
  session,
  owning,
}: {
  session: OAuthSession | null;
  owning: Holdings;
}) {
  const [found, setFound] = useState<{ format: Format; got: Read } | null>(
    null,
  );
  const [problem, setProblem] = useState("");
  const { state, start, resume, stop, discard } = useImport(
    session,
    owning.reload,
  );

  const steps = useMemo(
    () =>
      found && owning.ready
        ? plan(found.got.stacks, owning.stacks, new Date().toISOString())
        : null,
    [found, owning.ready, owning.stacks],
  );

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
    setFound({ format, got: read(text, format) });
  }

  if (!session) return <Gate />;

  if (state.at !== "none") {
    return <Job state={state} onward={{ resume, stop, discard }} />;
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

      {found && steps && (
        <>
          <p className="tally">
            {cards(steps).toLocaleString()} card
            {cards(steps) === 1 ? "" : "s"}
          </p>
          <p className="quiet">
            Read as {found.format.name}. {counts(steps)}, which takes{" "}
            {about(steps.length)} at the rate a PDS allows.
          </p>

          {found.got.skipped.length > 0 && (
            <ul className="skipped">
              {found.got.skipped.map(({ line, reason }) => (
                <li key={line}>
                  Line {line}: {reason}
                </li>
              ))}
            </ul>
          )}

          <button type="button" onClick={() => start(steps)}>
            Write {steps.length.toLocaleString()} records
          </button>
        </>
      )}
    </>
  );
}

// An import under way, or one waiting to be picked back up.
function Job({
  state,
  onward,
}: {
  state: Exclude<State, { at: "none" }>;
  onward: { resume: () => void; stop: () => void; discard: () => void };
}) {
  if (state.at === "done") {
    return (
      <>
        <p className="tally">
          {state.total.toLocaleString()} records written.
        </p>
        <button type="button" onClick={onward.discard}>
          Import another
        </button>
      </>
    );
  }

  const left = state.total - state.done;

  return (
    <>
      <p className="tally">
        {state.done.toLocaleString()} of {state.total.toLocaleString()} records
      </p>

      {state.at === "running" && (
        <p className="quiet">
          {state.until > Date.now()
            ? `Waiting for the write budget, ${about(left)} left.`
            : "Writing."}
        </p>
      )}

      {state.at === "failed" && <p className="warn">{state.why}</p>}

      {state.at === "held" && (
        <p className="quiet">An import from an earlier visit stopped here.</p>
      )}

      {state.at === "running" ? (
        <button type="button" onClick={onward.stop}>
          Stop
        </button>
      ) : (
        <button type="button" onClick={onward.resume}>
          Carry on
        </button>
      )}
      <button type="button" onClick={onward.discard}>
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

function counts(steps: Step[]): string {
  const held = steps.filter((one) => one.held).length;
  const made = steps.length - held;
  if (held === 0) return `${made.toLocaleString()} new stacks`;
  if (made === 0) return `${held.toLocaleString()} joining stacks you have`;
  return `${made.toLocaleString()} new stacks and ${held.toLocaleString()} joining ones you have`;
}

// Batches are spaced to the budget, so what an import costs is arithmetic.
function about(steps: number): string {
  const minutes = Math.round(
    (Math.max(Math.ceil(steps / BATCH) - 1, 0) * SPACING) / 60_000,
  );
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `about ${minutes} minutes`;
  return `about ${Math.round(minutes / 60)} hours`;
}
