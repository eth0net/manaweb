// A row, and the line of the file it starts on. A quoted field can hold line
// endings, so the two run apart and only the file's own numbering helps
// anyone looking at it.
export type Row = { fields: string[]; line: number };

// Quotes, every line ending, and a leading BOM: what the exports vary in is in
// `docs/scryfall.md`.
export function lined(text: string): Row[] {
  const rows: Row[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let begun = false;

  for (
    let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    at < text.length;
    at++
  ) {
    const ch = text.charAt(at);
    if (!begun) {
      start = line;
      begun = true;
    }

    if (quoted) {
      // A doubled quote is one quote, and a lone one ends the quoting.
      if (ch !== '"') {
        // A carriage return before a newline is the same ending, counted once.
        if (ch === "\n" || (ch === "\r" && text.charAt(at + 1) !== "\n")) {
          line++;
        }
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
      rows.push({ fields: row, line: start });
      row = [];
      field = "";
      begun = false;
      line++;
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push({ fields: row, line: start });
  }

  return rows;
}

export function parse(text: string): string[][] {
  return lined(text).map((row) => row.fields);
}
