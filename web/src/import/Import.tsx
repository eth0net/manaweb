import { useState } from "react";
import { detect, FORMATS, type Format } from "./formats";
import { header, type Read, read } from "./read";

export const IMPORT = "/collection/import";

const NAMES = FORMATS.map((one) => one.name).join(", ");

// A collection arriving from somewhere else, and the one point at which the
// app asks where it is all going to live.
export function Import({ signedIn }: { signedIn: boolean }) {
  const [found, setFound] = useState<{ format: Format; got: Read } | null>(
    null,
  );
  const [problem, setProblem] = useState("");

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

  if (!signedIn) return <Gate />;

  const cards = found?.got.stacks.reduce((sum, one) => sum + one.quantity, 0);

  return (
    <>
      <p>
        A CSV exported from another tracker. It is read here and nothing is
        written until you say so.
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => void take(event.target.files?.[0] ?? null)}
      />

      {problem && <p className="warn">{problem}</p>}

      {found && (
        <>
          <p className="tally">
            {cards?.toLocaleString()} card{cards === 1 ? "" : "s"}
          </p>
          <p className="quiet">
            {found.format.name}, in {found.got.stacks.length.toLocaleString()}{" "}
            stacks. A stack is one record, so that is what the import costs.
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
        </>
      )}
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
