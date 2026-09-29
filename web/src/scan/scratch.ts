// The list a scan lands in, and every move that can be made on it. Pure, so
// what holds the list decides where it is kept — `docs/scanner.md`.

import { FLOOR } from "../catalog/artwork";
import { COPIES, type Owned } from "../collection/cards";
import type { Read } from "./read";

// One artwork the frame came near, and every printing carrying it.
export type Matched = { distance: number; prints: string[] };

export type Entry = {
  id: string;
  at: string;
  // Bits between the nearest artwork and the next.
  margin: number;
  // False where no outline was found and the framing was guessed at.
  detected: boolean;
  // Nearest first. A printing is picked out of these, so changing one costs
  // no second photograph.
  matched: Matched[];
  scryfallId: string;
  // Whether a person said so. An index proposing a printing and somebody
  // agreeing it is the card in their hand are different claims, and only the
  // second one may be reported as an answer.
  picked?: boolean;
  finish: string;
  quantity: number;
};

// What the catalog says a printing was made in, passed in so nothing here
// needs a catalog of its own.
export type Finishes = (scryfallId: string) => string[];

const NONFOIL = "nonfoil";

export function sure(one: Entry): boolean {
  return one.margin >= FLOOR;
}

// One scan, one stack. Null where nothing it matched is a printing the
// catalog holds, there being no card to put in a list.
export function scanned(found: Read, id: string, at: string): Entry | null {
  const matched: Matched[] = [];
  const made = new Map<string, string[]>();

  for (const one of found.found) {
    if (one.prints.length === 0) continue;
    matched.push({
      distance: one.distance,
      prints: one.prints.map(({ print }) => print.id),
    });
    for (const { print } of one.prints) made.set(print.id, print.finishes);
  }

  const first = matched[0]?.prints[0];
  if (!first) return null;

  return {
    id,
    at,
    margin: gap(found, matched),
    detected: found.detected,
    matched,
    scryfallId: first,
    finish: settled(made.get(first) ?? []),
    quantity: 1,
  };
}

// How far the next artwork the catalog can name was. Not the read's own
// margin, which is measured against every artwork including the ones no
// printing carries: where one of those was nearer, nothing here was measured
// against anything and the answer is worth asking about.
function gap(found: Read, matched: Matched[]): number {
  const first = matched[0];
  const second = matched[1];
  if (!first) return 0;
  if (second) return second.distance - first.distance;
  return found.found[0]?.prints.length === 0 ? 0 : found.margin;
}

// A printing made one way only settles its own finish; the rest start
// nonfoil and can be turned over.
export function settled(finishes: string[]): string {
  if (finishes.length === 1) return finishes[0] as string;
  return finishes.includes(NONFOIL) ? NONFOIL : (finishes[0] ?? NONFOIL);
}

export function plus(list: Entry[], id: string): Entry[] {
  return list.map((one) =>
    one.id === id && one.quantity < COPIES
      ? { ...one, quantity: one.quantity + 1 }
      : one,
  );
}

// Zero takes the stack away, so the undo for a card counted twice is the same
// button as the one for a card counted once too often.
export function minus(list: Entry[], id: string): Entry[] {
  return list.flatMap((one) => {
    if (one.id !== id) return [one];
    return one.quantity > 1 ? [{ ...one, quantity: one.quantity - 1 }] : [];
  });
}

export function drop(list: Entry[], id: string): Entry[] {
  return list.filter((one) => one.id !== id);
}

// Any printing, not only one the scan matched. Holding it to the matches
// left nothing to say when the index had missed the card altogether, which
// is the reading most worth being able to correct.
export function choose(
  list: Entry[],
  id: string,
  scryfallId: string,
  finishes: Finishes,
): Entry[] {
  return list.map((one) => {
    if (one.id !== id || one.scryfallId === scryfallId) return one;
    return {
      ...one,
      scryfallId,
      picked: true,
      finish: settled(finishes(scryfallId)),
    };
  });
}

// Whether the index had this printing anywhere in what it returned. False
// against a person's own answer is the strongest thing a report can say.
export function offered(one: Entry, scryfallId: string): boolean {
  return one.matched.some(({ prints }) => prints.includes(scryfallId));
}

// A finish the printing was never made in is refused whatever asked for it.
export function refinish(
  list: Entry[],
  id: string,
  finish: string,
  finishes: Finishes,
): Entry[] {
  return list.map((one) =>
    one.id === id && finishes(one.scryfallId).includes(finish)
      ? { ...one, finish }
      : one,
  );
}

// Stacks of one printing become one, on request. Scanning records what
// somebody saw, and arrival is the wrong moment to tidy that away.
export function merged(list: Entry[]): Entry[] {
  const into = new Map<string, Entry>();
  const kept: Entry[] = [];

  for (const one of list) {
    const key = `${one.scryfallId}\t${one.finish}`;
    const held = into.get(key);
    if (held) {
      // A stack the ceiling has closed stays the one to try, so what follows
      // still joins it where there is room.
      if (held.quantity + one.quantity <= COPIES)
        held.quantity += one.quantity;
      else kept.push({ ...one });
      continue;
    }
    const copy = { ...one };
    kept.push(copy);
    into.set(key, copy);
  }

  return kept;
}

// Stacks a merge would take away, so it is offered only where it does
// something.
export function joinable(list: Entry[]): number {
  return list.length - merged(list).length;
}

export function copies(list: Entry[]): number {
  return list.reduce((sum, one) => sum + one.quantity, 0);
}

// The list as cards, for the path that writes them.
export function cards(list: Entry[], container: string | null): Owned[] {
  return list.map((one) => ({
    scryfallId: one.scryfallId,
    finish: one.finish,
    quantity: one.quantity,
    createdAt: one.at,
    ...(container ? { container } : {}),
  }));
}
