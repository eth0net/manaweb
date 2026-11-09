// The list a scan lands in, and every move that can be made on it. Pure, so
// what holds the list decides where it is kept — `docs/scanner.md`.

import { FLOOR } from "../catalog/artwork";
import { COPIES, joins, merge, type Owned, stack } from "../collection/cards";
import type { Read } from "./read";

// One artwork the frame came near, and every printing carrying it.
export type Matched = { distance: number; prints: string[] };

// What a list was read out of — `docs/scanner.md`. A file carries what its
// receipt will say, the digest being the file's rather than the list's.
export type Source =
  | { at: "scan" }
  | { at: "file"; format: string; file: string; digest: string };

export const SCANNED: Source = { at: "scan" };

// The four fields below are a scan's: a row read off a file has a line behind
// it instead, and nothing that came near an artwork.
export type Entry = {
  id: string;
  at: string;
  // Which line of the file this was.
  line?: number;
  // Bits between the nearest artwork and the next.
  margin?: number;
  // False where no outline was found and the framing was guessed at.
  detected?: boolean;
  // Nearest first. A printing is picked out of these, so changing one costs
  // no second photograph.
  matched?: Matched[];
  scryfallId: string;
  // Whether a person said so. An index proposing a printing and somebody
  // agreeing it is the card in their hand are different claims, and only the
  // second one may be reported as an answer.
  picked?: boolean;
  // When a frame of this stack was last sent back. Kept on the entry rather
  // than in a component, so it survives the panel closing and the tab dying.
  reported?: string;
  finish: string;
  // What the stack is kept at, `""` being ungraded — `docs/scanner.md`.
  condition: string;
  quantity: number;
  // What a file said that a scan never does. Carried whole rather than field
  // by field, so a column the reader learns next is not one a review drops.
  rest?: Rest;
};

export type Rest = Omit<
  Owned,
  "scryfallId" | "finish" | "quantity" | "createdAt" | "condition"
>;

// What the catalog says a printing was made in, passed in so nothing here
// needs a catalog of its own.
export type Finishes = (scryfallId: string) => string[];

const NONFOIL = "nonfoil";

// Whether the reader settled it on its own. Two conditions, because the
// margin measures the artwork and an artwork is not a printing.
export function sure(one: Entry): boolean {
  return (
    (one.margin ?? 0) >= FLOOR && (one.matched?.[0]?.prints.length ?? 0) === 1
  );
}

// The printings the winning artwork carries. One is an answer; several is a
// question the bottom line of the card would settle and nothing reads yet.
export function among(one: Entry): string[] {
  return one.matched?.[0]?.prints ?? [];
}

// One scan, one stack. Null where nothing it matched is a printing the
// catalog holds, there being no card to put in a list.
export function scanned(
  found: Read,
  id: string,
  at: string,
  condition: string,
): Entry | null {
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
    detected: found.quad !== null,
    matched,
    scryfallId: first,
    finish: settled(made.get(first) ?? []),
    condition,
    quantity: 1,
  };
}

// How far the next artwork the catalog can name was, which is not the read's
// own margin: that one counts artworks no printing carries.
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

// What a panel settles on rather than a press at a time. One is the floor:
// taking the stack away is the list's own move.
export function counted(list: Entry[], id: string, quantity: number): Entry[] {
  const held = Math.min(Math.max(1, Math.trunc(quantity)), COPIES);
  return list.map((one) => (one.id === id ? { ...one, quantity: held } : one));
}

export function reported(list: Entry[], id: string, at: string): Entry[] {
  return list.map((one) => (one.id === id ? { ...one, reported: at } : one));
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
    if (one.id !== id) return one;
    // Agreeing with what the reader already said is an answer too, and the
    // finish is left alone because nothing about the printing changed.
    if (one.scryfallId === scryfallId) return { ...one, picked: true };
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
  return (one.matched ?? []).some(({ prints }) => prints.includes(scryfallId));
}

// Every printing the list needs a catalog row for. The matches alone leave
// out the one case `choose` exists to cover, a card named that nothing
// matched.
export function referenced(list: Entry[]): string[] {
  const all = new Set<string>();
  for (const one of list) {
    all.add(one.scryfallId);
    for (const { prints } of one.matched ?? [])
      for (const id of prints) all.add(id);
  }
  return [...all].sort();
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

// The next finish the printing was made in, wrapping — a press rather than a
// list, which comes to a toggle where it was made two ways.
export function cycled(
  list: Entry[],
  id: string,
  finishes: Finishes,
): Entry[] {
  return list.map((one) => {
    if (one.id !== id) return one;
    const made = finishes(one.scryfallId);
    if (made.length < 2) return one;
    const at = made.indexOf(one.finish);
    return { ...one, finish: made[(at + 1) % made.length] as string };
  });
}

export function regraded(
  list: Entry[],
  id: string,
  condition: string,
): Entry[] {
  return list.map((one) => (one.id === id ? { ...one, condition } : one));
}

// Stacks of one printing become one, on request. Scanning records what
// somebody saw, and arrival is the wrong moment to tidy that away.
//
// Held to the identity a record is written under rather than to a key of its
// own: a file's rows differ in ways a scan's never do, and two that a write
// would keep apart must not be joined here.
export function merged(list: Entry[]): Entry[] {
  const into = new Map<string, number>();
  const kept: Entry[] = [];

  for (const one of list) {
    const mine = record(one);
    const at = into.get(stack(mine));

    if (at === undefined) {
      into.set(stack(mine), kept.length);
      kept.push({ ...one });
      continue;
    }

    // A stack the ceiling has closed stays the one to try, so what follows
    // still joins it where there is room.
    const held = kept[at] as Entry;
    if (joins(record(held), mine)) kept[at] = folded(held, one);
    else kept.push({ ...one });
  }

  return kept;
}

// The stack that replaces both: what the list holds of the first, and what
// the two records come to together.
function folded(held: Entry, one: Entry): Entry {
  const { scryfallId, finish, quantity, createdAt, condition, ...rest } =
    merge(record(held), record(one));

  return {
    ...held,
    quantity,
    at: createdAt,
    ...(Object.keys(rest).length > 0 ? { rest } : {}),
  };
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
  return list.map((one) => record(one, container));
}

// The record one stack stands for, which is what decides whether two of them
// are one.
function record(one: Entry, container: string | null = null): Owned {
  return {
    // First, so what the list itself holds wins where the two overlap.
    ...one.rest,
    scryfallId: one.scryfallId,
    finish: one.finish,
    quantity: one.quantity,
    createdAt: one.at,
    ...(one.condition ? { condition: one.condition } : {}),
    ...(container ? { container } : {}),
  };
}
