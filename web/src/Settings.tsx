import { usePreference } from "./preferences";

// What a person has set, which today is one answer about what a set holds.
export function Settings() {
  const treatments = usePreference("treatments");

  return (
    <dl className="panel-grid">
      <dt>
        <label htmlFor="count-treatments">Count treatments</label>
      </dt>
      <dd>
        <input
          id="count-treatments"
          type="checkbox"
          checked={treatments.held}
          onChange={(event) => treatments.change(event.target.checked)}
        />
      </dd>
      <dd className="quiet aside">
        A set is complete when both finishes of every printing are held, not
        when every printing is.
      </dd>
    </dl>
  );
}
