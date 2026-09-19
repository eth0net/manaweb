import { useState } from "react";
import { words } from "../catalog";
import { Modal } from "../Modal";
import type { Holdings } from "./cards";
import { type Containers, KINDS, UNFILED } from "./containers";

export function Destination({
  containers,
  owning,
  chosen,
  onChoose,
}: {
  containers: Containers;
  owning: Holdings;
  chosen: string | null;
  onChoose: (uri: string | null) => void;
}) {
  const { held, error, add, drop } = containers;
  const here = held.find((one) => one.uri === chosen);

  return (
    <Modal
      trigger="tool"
      title="Where cards go"
      label={
        <>
          <span className="quiet">Adding to</span>
          {here?.value.name ?? UNFILED.name}
          <span className="quiet" aria-hidden="true">
            ▾
          </span>
        </>
      }
    >
      <ul className="places">
        <li>
          <button
            type="button"
            className="link"
            aria-current={chosen === null}
            onClick={() => onChoose(null)}
          >
            {UNFILED.name}
          </button>
          <span>everything not filed anywhere</span>
        </li>
        {held.map((one) => (
          <li key={one.uri}>
            <button
              type="button"
              className="link"
              aria-current={one.uri === chosen}
              onClick={() => onChoose(one.uri)}
            >
              {one.value.name}
            </button>
            {one.value.kind && <span>{words(one.value.kind)}</span>}
            {/* The cards outlive the record naming them, so they are put
              back to unfiled before it goes. */}
            <button
              type="button"
              onClick={async () => {
                if (one.uri === chosen) onChoose(null);
                await owning.unfile(one.uri);
                await drop(one.uri);
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <New add={add} />
      {error && <p className="warn">{error}</p>}
    </Modal>
  );
}

function New({ add }: { add: Containers["add"] }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(KINDS[0] as string);

  return (
    <form
      className="query"
      onSubmit={(event) => {
        event.preventDefault();
        void add(name, kind);
        setName("");
      }}
    >
      <input
        type="search"
        value={name}
        placeholder="New binder or box"
        onChange={(event) => setName(event.target.value)}
      />
      <select value={kind} onChange={(event) => setKind(event.target.value)}>
        {KINDS.map((one) => (
          <option key={one} value={one}>
            {words(one)}
          </option>
        ))}
      </select>
      <button type="submit" disabled={name.trim().length === 0}>
        Add
      </button>
    </form>
  );
}
