// Quotes, every line ending, and a leading BOM: what the exports vary in is in
// `docs/scryfall.md`.
export function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (
    let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    at < text.length;
    at++
  ) {
    const ch = text.charAt(at);

    if (quoted) {
      // A doubled quote is one quote, and a lone one ends the quoting.
      if (ch !== '"') {
        field += ch;
      } else if (text.charAt(at + 1) === '"') {
        field += '"';
        at++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text.charAt(at + 1) === "\n") at++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
