// A file's rows as the list they are reviewed in — `docs/scryfall.md`. The
// scratch list is the scanner's, and these rows carry a line where a scan
// carries the artworks it came near.

import type { Entry } from "../scan/scratch";
import type { Row } from "./read";

export function taken(rows: Row[]): Entry[] {
  return rows.map(({ line, one }) => {
    const { scryfallId, finish, quantity, createdAt, condition, ...rest } =
      one;
    return {
      // The line is already unique down a file, so it is the key as well.
      id: String(line),
      at: createdAt,
      line,
      scryfallId,
      finish,
      quantity,
      condition: condition ?? "",
      ...(Object.keys(rest).length > 0 ? { rest } : {}),
    };
  });
}
