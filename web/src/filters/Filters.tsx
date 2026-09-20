import type { Catalog } from "../catalog";
import { Modal } from "../Modal";
import { KEY, read, value } from "../terms";
import { asked, Mode } from "./Colors";
import { Count, counting } from "./Count";
import type { Editing } from "./editing";
import { Language } from "./Language";
import { Sort } from "./Sort";
import { Types } from "./Types";

// The rest, behind one control: each is worth having and none is worth a slot
// in a row a phone has to carry.
export function More({
  catalog,
  text,
  onText,
}: Editing & { catalog: Catalog }) {
  const editing = { text, onText };

  return (
    <Modal
      trigger="tool"
      title="Filters"
      label={
        <>
          Filters{set(text) > 0 && ` · ${set(text)}`}
          <span className="quiet" aria-hidden="true">
            ▾
          </span>
        </>
      }
    >
      <h3>Colors</h3>
      <p className="quiet">
        Identity is what a Commander deck may play; color is what the card is.
        A card carries <em>at least</em> the pips pressed, <em>exactly</em>
        them, <em>at most</em> them — a deck of those colors could play it — or
        any one of them. Press a pip twice to refuse that color instead.
      </p>
      <Mode {...editing} />

      <h3>How many colors</h3>
      <Count {...editing} />

      <Types catalog={catalog} {...editing} />

      <h3>Language</h3>
      <Language catalog={catalog} {...editing} />

      <h3>Sort</h3>
      <Sort {...editing} />
    </Modal>
  );
}

// A filter left on in the panel is invisible from outside it, so the trigger
// carries how many.
function set(text: string): number {
  const { key, match, refused } = asked(text);
  const span = counting(text, key);

  return [
    key === KEY.identity,
    match !== ":",
    refused.length > 0,
    span.low !== "" || span.high !== "",
    read(text, KEY.type).values.length > 0,
    value(text, KEY.lang),
    value(text, KEY.order),
  ].filter(Boolean).length;
}
