import { type Catalog, language } from "../catalog";
import { KEY, one, value } from "../terms";
import type { Editing } from "./editing";

export function Language({
  catalog,
  text,
  onText,
}: Editing & { catalog: Catalog }) {
  return (
    <select
      value={value(text, KEY.lang)}
      aria-label="Language"
      onChange={(event) => onText(one(text, KEY.lang, event.target.value))}
    >
      <option value="">Any language</option>
      {catalog.languages.map((code) => (
        <option key={code} value={code}>
          {language(code)}
        </option>
      ))}
    </select>
  );
}
