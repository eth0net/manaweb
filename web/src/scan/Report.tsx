// The report a person writes, in their own words, about a read that went
// wrong. Development only, and reached by dynamic import so the module and
// the route it posts to go with the branch — `docs/scanner.md`.

import { useState } from "react";
import type { Catalog, Print } from "../catalog";
import type { Read as Kept } from "./frames";
import { reading, send } from "./frames";
import { Finding, labeled } from "./Review";
import type { Read } from "./read";
import type { Entry } from "./scratch";

export function Report({
  catalog,
  frame,
  found,
  entry,
  onDone,
}: {
  catalog: Catalog;
  // Which held frame this is about.
  frame: string;
  found: Read | null;
  // The stack the read made, where it made one.
  entry: Entry | null;
  onDone: () => void;
}) {
  // An entry carries the whole reading; without one the frame was read and
  // named nothing, which the margin still describes.
  const read: Kept | null = entry
    ? reading(entry)
    : found
      ? {
          at: new Date().toISOString(),
          margin: found.margin,
          detected: found.detected,
          matched: [],
          said: "",
        }
      : null;

  const [wrong, setWrong] = useState("");
  const [named, setNamed] = useState<Print | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  async function post() {
    setSending(true);
    setProblem("");
    try {
      await send(frame, {
        read,
        answer: named
          ? {
              print: named.id,
              label: labeled(named),
              finish: named.finishes[0] ?? "nonfoil",
              matched: (read?.matched ?? []).some(({ prints }) =>
                prints.includes(named.id),
              ),
            }
          : null,
        wrong: wrong.trim(),
      });
      onDone();
    } catch (failed: unknown) {
      setProblem(failed instanceof Error ? failed.message : String(failed));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="report">
      <p className="quiet">
        {read
          ? read.detected
            ? "A card was found in the frame."
            : "No outline was found, so the frame was read whole."
          : "Nothing in the frame looked like a card."}
      </p>

      <label htmlFor="report-wrong">What is wrong with it?</label>
      <textarea
        id="report-wrong"
        value={wrong}
        rows={3}
        placeholder="A phantom card on an empty mat. Read the back face. Glare over the set symbol."
        onChange={(event) => setWrong(event.target.value)}
      />

      {named ? (
        <p>
          Reporting it as <strong>{named.set.toUpperCase()}</strong> #
          {named.collectorNumber}{" "}
          <button
            type="button"
            className="link"
            onClick={() => setNamed(null)}
          >
            not that
          </button>
        </p>
      ) : (
        <Finding catalog={catalog} onPick={setNamed} />
      )}

      {problem && <p className="warn">{problem}</p>}

      <p className="report-does">
        <button type="button" onClick={() => void post()} disabled={sending}>
          {sending ? "Sending…" : "Send the report"}
        </button>
        <button type="button" onClick={onDone} disabled={sending}>
          Cancel
        </button>
      </p>
    </div>
  );
}
