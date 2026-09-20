import { KEY, one, value } from "../terms";
import type { Editing } from "./editing";

// What the artifact can sort on. `docs/search.md` has the rest.
const ORDER = [
  ["", "Best match"],
  ["name", "Name"],
  ["mv", "Mana value"],
  ["rarity", "Rarity"],
  ["released", "Released"],
  ["edhrec", "Popularity"],
  ["printings", "Printings"],
];

export function Sort({ text, onText }: Editing) {
  const order = value(text, KEY.order);
  const down = value(text, KEY.dir) === "desc";

  return (
    <span className="sort">
      <select
        value={order}
        aria-label="Sort by"
        onChange={(event) => onText(one(text, KEY.order, event.target.value))}
      >
        {ORDER.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="way"
        disabled={!order}
        aria-label={down ? "Descending" : "Ascending"}
        onClick={() => onText(one(text, KEY.dir, down ? "" : "desc"))}
      >
        {down ? "↓" : "↑"}
      </button>
    </span>
  );
}
