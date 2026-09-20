import { canonical, type Key, read, write } from "../terms";
import { asked } from "./Colors";
import type { Editing } from "./editing";

const COUNT = { shape: "count" } as const;

const MANY = ["0", "1", "2", "3", "4", "5"];

// How many colors is a range, so it is `c>=2 c<=4` — one key holding two
// comparisons, which neither the pips nor a single term can express.
export function counting(text: string, key: Key) {
  const { terms } = read(text, key, COUNT);
  const at = (ops: string[]) =>
    terms.find((one) => ops.includes(one.op))?.value ?? "";
  const exact = at(["=", ":"]);
  return exact
    ? { low: exact, high: exact }
    : { low: at([">=", ">"]), high: at(["<=", "<"]) };
}

// Two comparisons, where `write` carries one — and a key is written the one
// way it is spelled, though reading takes any of them.
export function counted(
  text: string,
  key: Key,
  low: string,
  high: string,
): string {
  const name = canonical(key);
  const left = write(text, key, [], COUNT);
  const terms =
    low && low === high
      ? [`${name}=${low}`]
      : [low && `${name}>=${low}`, high && `${name}<=${high}`];
  return [left, ...terms].filter(Boolean).join(" ");
}

// What the other end rules out is shown and refused rather than dropped: a
// list that keeps its length is read by position the second time.
function within(many: string, low: string, high: string): boolean {
  return (
    (low === "" || Number(many) >= Number(low)) &&
    (high === "" || Number(many) <= Number(high))
  );
}

export function Count({ text, onText }: Editing) {
  const { key } = asked(text);
  const span = counting(text, key);

  return (
    <p className="actions">
      <label className="span">
        Min
        <select
          value={span.low}
          aria-label="Fewest colors"
          onChange={(event) =>
            onText(counted(text, key, event.target.value, span.high))
          }
        >
          <option value="">Any</option>
          {MANY.map((many) => (
            <option
              key={many}
              value={many}
              disabled={!within(many, "", span.high)}
            >
              {many}
            </option>
          ))}
        </select>
      </label>
      <label className="span">
        Max
        <select
          value={span.high}
          aria-label="Most colors"
          onChange={(event) =>
            onText(counted(text, key, span.low, event.target.value))
          }
        >
          <option value="">Any</option>
          {MANY.map((many) => (
            <option
              key={many}
              value={many}
              disabled={!within(many, span.low, "")}
            >
              {many}
            </option>
          ))}
        </select>
      </label>
    </p>
  );
}
