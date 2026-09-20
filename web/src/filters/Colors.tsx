import { Mana } from "../Mana";
import { type Held, KEY, type Key, read, write } from "../terms";
import { counted, counting } from "./Count";
import type { Editing } from "./editing";

// Colorless is the absence of a color rather than one more of them, so it is
// asked for alone: pressing it clears the rest, and any of them clears it.
const COLORS = ["W", "U", "B", "R", "G", "C"];

const NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

// Three of the four are operators and the fourth is a disjunction, which is
// the whole reason grouping exists — see `docs/search.md`.
const MATCH = [
  [":", "At least"],
  ["=", "Exactly"],
  ["<=", "At most"],
  ["any", "Any of"],
];

// The pips write letters, so a count term stays where it is.
export const LETTERS = { shape: "letters" } as const;

// Read back out of how the term was written, so a typed query lights the same
// pips a tapped one does.
export function asked(text: string) {
  const key: Key =
    read(text, KEY.identity, LETTERS).values.length > 0
      ? KEY.identity
      : KEY.colors;
  const held = read(text, key, LETTERS);
  return {
    key,
    match: held.values.length > 1 ? "any" : held.op,
    held,
    refused: lit(read(text, key, { ...LETTERS, not: true })),
  };
}

// The letters pressed, however the term spells them.
function lit(held: Held): string {
  return held.values.join("").toUpperCase();
}

function put(key: Key, match: string, colors: string, text: string): string {
  const wanted = colors ? [colors.toLowerCase()] : [];
  if (match !== "any") {
    return write(text, key, wanted, { ...LETTERS, op: match });
  }
  return write(text, key, [...colors.toLowerCase()], LETTERS);
}

// Each refusal stands alone: `-c:r -c:g` is neither, where an `or` group
// would be the wrong question.
function deny(key: Key, colors: string, text: string): string {
  return write(text, key, [...colors.toLowerCase()], {
    ...LETTERS,
    not: true,
    all: true,
  });
}

function drop(colors: string, color: string): string {
  return colors.replace(color, "");
}

function add(colors: string, color: string): string {
  return color === "C" || colors === "C" ? color : colors + color;
}

// Reached for on every search, so it keeps its place in the row.
export function Colors({ text, onText }: Editing) {
  const { key, match, held, refused } = asked(text);
  const colors = lit(held);

  // Wanted, refused, then neither — three states on one press, because a
  // second control saying "without red" would cost a slot for one word.
  const press = (color: string) => {
    if (colors.includes(color)) {
      const left = put(key, match, drop(colors, color), text);
      return deny(key, add(refused, color), left);
    }
    if (refused.includes(color)) return deny(key, drop(refused, color), text);
    const left = deny(key, drop(refused, color), text);
    return put(key, match, add(colors, color), left);
  };

  return (
    <span className="colors">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={refused.includes(color) ? "pip refused" : "pip"}
          aria-label={NAMES[color]}
          aria-pressed={colors.includes(color)}
          onClick={() => onText(press(color))}
        >
          <Mana cost={`{${color}}`} />
        </button>
      ))}
    </span>
  );
}

// Which of the two color questions the pips ask, and how.
export function Mode({ text, onText }: Editing) {
  const { key, match, held, refused } = asked(text);

  return (
    <p className="actions">
      <select
        value={key === KEY.identity ? "id" : "c"}
        aria-label="Which colors"
        onChange={(event) =>
          onText(
            moved(
              text,
              key,
              event.target.value === "id" ? KEY.identity : KEY.colors,
              { match, colors: lit(held), refused },
            ),
          )
        }
      >
        <option value="c">Color</option>
        <option value="id">Identity</option>
      </select>
      <select
        value={match}
        aria-label="How they match"
        onChange={(event) =>
          onText(put(key, event.target.value, lit(held), text))
        }
      >
        {MATCH.map(([op, label]) => (
          <option key={op} value={op}>
            {label}
          </option>
        ))}
      </select>
    </p>
  );
}

// Asking the other question moves everything already asked — the pips, what
// they refuse, and the range — rather than keeping the half it can see.
function moved(
  text: string,
  from: Key,
  to: Key,
  held: { match: string; colors: string; refused: string },
): string {
  const span = counting(text, from);
  let left = write(text, from, [], LETTERS);
  left = write(left, from, [], { ...LETTERS, not: true });
  left = counted(left, from, "", "");

  const wanted = put(to, held.match, held.colors, left);
  return counted(deny(to, held.refused, wanted), to, span.low, span.high);
}
