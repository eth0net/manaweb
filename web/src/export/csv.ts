// Quoted only where a bare field would read as something else, which is what
// every tracker's own exports do and what `import/csv.ts` reads back.
function field(text: string): string {
  return /["\r\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function write(rows: string[][]): string {
  return rows.map((row) => row.map(field).join(",")).join("\n") + "\n";
}
