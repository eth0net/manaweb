import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Acquisition, Main } from "../lexicons/app/manaweb/card";
import {
  create,
  type Fields,
  type Held,
  list,
  put,
  remove,
  rkey,
} from "../oauth/repo";
import { recall, remember } from "./store";

export const CARD = "app.manaweb.card";

// How long a change settles before the cache is rewritten.
const SAVE = 1000;

// The lexicon's `knownValues`, best grade first.
export const CONDITIONS = [
  "mint",
  "nearMint",
  "excellent",
  "good",
  "lightPlayed",
  "played",
  "poor",
];

// Copies you own, however many of them are identical.
export type Owned = Fields<Main>;

// One record, and where the repo holds it. `waiting` counts copies an import
// has in the repo but not yet as records of their own, which `value` therefore
// does not hold: everything shown adds the two, and everything written uses
// `value.quantity` alone.
export type Stack = Held<Owned> & { waiting?: number };

// A stack no record holds yet, so there is nothing to write to.
const WAITING = "waiting:";

export function unwritten(one: Stack): boolean {
  return one.uri.startsWith(WAITING);
}

export function shown(one: Stack): number {
  return one.value.quantity + (one.waiting ?? 0);
}

// The collection with what an import is still landing folded in, keyed the way
// the drain will key it, so what shows now is what will be there.
export function landing(held: Stack[], waiting: Owned[]): Stack[] {
  if (waiting.length === 0) return held;

  const shelf = held.map((one) => ({ ...one }));
  const by = new Map<string, Stack>();
  for (const one of shelf) {
    const key = stack(one.value);
    if (!by.has(key)) by.set(key, one);
  }

  for (const entry of waiting) {
    const key = stack(entry);
    const into = by.get(key);

    if (into && joins({ ...into.value, quantity: shown(into) }, entry)) {
      into.waiting = (into.waiting ?? 0) + entry.quantity;
      continue;
    }

    const made: Stack = {
      uri: `${WAITING}${key}`,
      cid: "",
      value: { ...entry, quantity: 0 },
      waiting: entry.quantity,
    };
    shelf.push(made);
    if (!into) by.set(key, made);
  }

  return shelf;
}

// What an amendment comes to: the writes it needs, and the stacks left after.
export type Change = {
  writes: { uri: string; value: Owned }[];
  drops: string[];
  stacks: Stack[];
};

export type Holdings = {
  ready: boolean;
  error?: string;
  // Copies of one printing, wherever they sit and whatever grade they carry,
  // narrowed to one finish where that is given.
  owned: (scryfallId: string, finish?: string) => number;
  // Copies filed in one place, or unfiled where that is null.
  copies: (container: string | null) => number;
  // Copies of one printing and finish where adds are going.
  filed: (scryfallId: string, finish: string) => number;
  // Every stack, for listing one place's contents.
  stacks: Stack[];
  // Every printing owned, for asking the catalog where they all sit.
  printings: string[];
  total: number;
  add: (scryfallId: string, finish: string) => Promise<void>;
  take: (scryfallId: string, finish: string) => Promise<void>;
  amend: (uri: string, changes: Partial<Owned>) => Promise<void>;
  // Cards outlive the container naming them, so a place is emptied before it
  // is deleted.
  unfile: (container: string) => Promise<void>;
  // Reads the collection again, for a write this view did not make.
  reload: () => void;
  // Folds in records another part of the app wrote, so a long import fills the
  // collection in as it lands rather than at the end.
  landed: (stacks: Stack[]) => void;
  // The stacks as they stand, for a caller outside React that must not wait for
  // a render to see them. Null until the first read answers.
  snapshot: () => Stack[] | null;
};

// The lexicon's ceilings on one stack: lots recorded, copies held, tags, the
// characters in one tag, and the graphemes in a note.
export const LOTS = 64;
export const COPIES = 10000;
export const TAGS = 32;
export const TAG = 64;
export const NOTE = 300;

// Everything said about these copies in particular, which is what makes two
// stacks of one printing different things rather than one count split in two.
export function stack(
  one: Pick<Owned, "scryfallId" | "finish"> & Partial<Owned>,
): string {
  return JSON.stringify([
    one.scryfallId,
    one.finish,
    one.condition ?? null,
    one.container ?? null,
    one.proxy ?? false,
    [...(one.tags ?? [])].sort(),
    one.note ?? null,
  ]);
}

// One amendment against the stacks as they stand, which a merge needs whole:
// a change landing on another stack's identity joins it.
export function apply(
  stacks: Stack[],
  uri: string,
  changes: Partial<Owned>,
  at: string,
): Change {
  const one = stacks.find((other) => other.uri === uri);
  if (!one) return { writes: [], drops: [], stacks };

  const next = clean({ ...one.value, ...changes, updatedAt: at });
  const rest = stacks.filter((other) => other.uri !== uri);

  if (next.quantity < 1) return { writes: [], drops: [uri], stacks: rest };

  const into = rest.find((other) => joins(other.value, next));
  if (into) {
    const merged = merge(into.value, next, at);
    return {
      writes: [{ uri: into.uri, value: merged }],
      drops: [uri],
      stacks: rest.map((other) =>
        other.uri === into.uri ? { ...other, value: merged } : other,
      ),
    };
  }

  return {
    writes: [{ uri, value: next }],
    drops: [],
    stacks: stacks.map((other) =>
      other.uri === uri ? { ...other, value: next } : other,
    ),
  };
}

// Whether two stacks are one: the same identity, and neither ceiling crossed
// by putting them together.
export function joins(one: Owned, other: Owned): boolean {
  return (
    stack(one) === stack(other) &&
    one.quantity + other.quantity <= COPIES &&
    lots(one).length + lots(other).length <= LOTS
  );
}

// The record that replaces both: every copy, both histories, and the earlier
// of the two beginnings. A merge with no timestamp is one not written yet.
export function merge(one: Owned, other: Owned, at?: string): Owned {
  const all = [...lots(one), ...lots(other)];
  return clean({
    ...one,
    ...(at ? { updatedAt: at } : {}),
    quantity: one.quantity + other.quantity,
    acquisitions: all.length > 0 ? all : undefined,
    createdAt: earlier(one.createdAt, other.createdAt),
  });
}

function lots(one: Owned): Acquisition[] {
  return one.acquisitions ?? [];
}

// Two changes in order, so a record written and then dropped is only dropped.
export function then(first: Change, second: Change): Change {
  const writes = new Map(
    [...first.writes, ...second.writes].map((one) => [one.uri, one]),
  );
  for (const uri of second.drops) writes.delete(uri);
  return {
    writes: [...writes.values()],
    drops: [...first.drops, ...second.drops],
    stacks: second.stacks,
  };
}

export function useCollection(
  session: OAuthSession | null,
  destination: string | null,
  waiting: Owned[] = [],
): Holdings {
  const [held, setHeld] = useState<Stack[]>([]);
  const [ready, setReady] = useState(false);
  // Whether the repo itself has answered, as against the cache having painted.
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string>();
  // Which read is the current one, so a slow answer to a stale session or an
  // unmounted view lands nowhere.
  const read = useRef(0);
  // Records written while a read was in flight. A full read is many round
  // trips, so an import can land a batch before it answers, and the answer
  // would otherwise be a view of the repo from before that batch.
  const since = useRef(new Map<string, Stack>());
  // Which read the repo has answered, so what the last visit saw is never laid
  // over something newer.
  const answered = useRef(0);

  const reload = useCallback(() => {
    if (!session) {
      setHeld([]);
      setReady(false);
      setFresh(false);
      return;
    }
    setFresh(false);
    const mine = ++read.current;
    const { did } = session;

    // What the last visit saw, while the repo is asked again.
    recall(did).then((cached) => {
      if (mine !== read.current || answered.current === mine || !cached)
        return;
      setHeld(fold(cached, since.current));
      setReady(true);
    });

    list<Owned>(session, CARD).then(
      (found) => {
        if (mine !== read.current) return;
        const next = fold(found, since.current);
        answered.current = mine;
        setHeld(next);
        since.current.clear();
        setReady(true);
        setFresh(true);
      },
      (failure: unknown) => mine === read.current && setError(reason(failure)),
    );
  }, [session]);

  useEffect(() => {
    reload();
    return () => {
      read.current++;
    };
  }, [reload]);

  // Writes this client made are the collection too, so the next visit paints
  // them and not the read they replaced. Waiting is what makes five presses of
  // a plus one save rather than five of two megabytes.
  useEffect(() => {
    if (!session || !ready) return;
    const { did } = session;
    const soon = setTimeout(() => void remember(did, held), SAVE);
    return () => clearTimeout(soon);
  }, [session, ready, held]);

  // Read by the import, which cannot be re-rendered into knowing. It waits for
  // the repo's own answer, for the reason in `docs/architecture.md`.
  const current = useRef<Stack[] | null>(null);
  useEffect(() => {
    current.current = fresh ? held : null;
  }, [held, fresh]);
  const snapshot = useCallback(() => current.current, []);

  const landed = useCallback((written: Stack[]) => {
    if (written.length === 0) return;
    for (const one of written) since.current.set(one.uri, one);
    setHeld((was) => fold(was, since.current));
  }, []);

  // What the collection shows, which is not what it writes to: an import puts
  // cards in the repo hours before they are records, and a total that ignored
  // them would read as half a collection.
  const shelf = useMemo(() => landing(held, waiting), [held, waiting]);

  const totals = useMemo(() => {
    const prints = new Map<string, number>();
    const finishes = new Map<string, number>();
    const places = new Map<string | null, number>();
    let total = 0;
    for (const one of shelf) {
      const { value } = one;
      const print = value.scryfallId;
      const finish = JSON.stringify([print, value.finish]);
      const place = value.container ?? null;
      const count = shown(one);
      prints.set(print, (prints.get(print) ?? 0) + count);
      finishes.set(finish, (finishes.get(finish) ?? 0) + count);
      places.set(place, (places.get(place) ?? 0) + count);
      total += count;
    }
    return { prints, finishes, places, total };
  }, [shelf]);

  const owned = useCallback(
    (scryfallId: string, finish?: string) =>
      (finish === undefined
        ? totals.prints.get(scryfallId)
        : totals.finishes.get(JSON.stringify([scryfallId, finish]))) ?? 0,
    [totals],
  );

  const copies = useCallback(
    (container: string | null) => totals.places.get(container) ?? 0,
    [totals],
  );

  // What a plus or a minus reaches: an ungraded stack of this printing where
  // adds are going, rather than every copy owned.
  const target = useCallback(
    (scryfallId: string, finish: string) =>
      held.find(
        (one) =>
          stack(one.value) ===
          stack({
            scryfallId,
            finish,
            ...(destination ? { container: destination } : {}),
          }),
      ),
    [held, destination],
  );

  const filed = useCallback(
    (scryfallId: string, finish: string) =>
      target(scryfallId, finish)?.value.quantity ?? 0,
    [target],
  );

  // The local view is the writes this client just made, so nothing is re-read
  // to learn what it already decided.
  const run = useCallback(
    async (change: Change) => {
      if (!session) return;
      try {
        const written = new Map<string, string>();
        for (const { uri, value } of change.writes) {
          const { cid } = await put(session, CARD, rkey(uri), value);
          written.set(uri, cid);
        }
        for (const uri of change.drops) {
          await remove(session, CARD, rkey(uri));
        }
        setHeld(
          change.stacks.map((one) => {
            const cid = written.get(one.uri);
            return cid ? { ...one, cid } : one;
          }),
        );
      } catch (failure) {
        setError(reason(failure));
      }
    },
    [session],
  );

  const amend = useCallback(
    async (uri: string, changes: Partial<Owned>) => {
      // Nothing addresses a stack an import has not written yet, and a key
      // taken from one would reach some other record or none.
      if (uri.startsWith(WAITING)) return;
      await run(apply(held, uri, changes, new Date().toISOString()));
    },
    [held, run],
  );

  const add = useCallback(
    async (scryfallId: string, finish: string) => {
      if (!session) return;
      const already = target(scryfallId, finish);
      if (already) {
        await amend(already.uri, { quantity: already.value.quantity + 1 });
        return;
      }

      const record = clean({
        scryfallId,
        finish,
        quantity: 1,
        createdAt: new Date().toISOString(),
        ...(destination ? { container: destination } : {}),
      });
      try {
        const written = await create(session, CARD, record);
        setHeld((was) => [...was, { ...written, value: record }]);
      } catch (failure) {
        setError(reason(failure));
      }
    },
    [session, destination, target, amend],
  );

  const take = useCallback(
    async (scryfallId: string, finish: string) => {
      const one = target(scryfallId, finish);
      if (one) await amend(one.uri, { quantity: one.value.quantity - 1 });
    },
    [target, amend],
  );

  const unfile = useCallback(
    async (container: string) => {
      const at = new Date().toISOString();
      let change: Change = { writes: [], drops: [], stacks: held };
      for (const one of held) {
        if (one.value.container !== container) continue;
        change = then(
          change,
          apply(change.stacks, one.uri, { container: undefined }, at),
        );
      }
      if (change.writes.length > 0 || change.drops.length > 0) {
        await run(change);
      }
    },
    [held, run],
  );

  const printings = useMemo(() => [...totals.prints.keys()], [totals]);

  return {
    ready,
    error,
    owned,
    copies,
    filed,
    stacks: shelf,
    printings,
    total: totals.total,
    add,
    take,
    amend,
    unfile,
    reload,
    landed,
    snapshot,
  };
}

// What a read found, with anything written since laid over it.
export function fold(found: Stack[], since: Map<string, Stack>): Stack[] {
  if (since.size === 0) return found;

  const by = new Map(found.map((one) => [one.uri, one]));
  for (const [uri, one] of since) by.set(uri, one);
  return [...by.values()];
}

// Timestamps carry whatever offset wrote them, so they compare as instants.
export function earlier(one: string, other: string): string {
  return Date.parse(one) <= Date.parse(other) ? one : other;
}

// The shape a record is written in: tags as the set they are, history in date
// order, and undefined dropped, which is absence only once JSON has run.
function clean(one: Owned): Owned {
  const kept = Object.entries(one).filter(([, value]) => value !== undefined);
  const record = Object.fromEntries(kept) as Owned;
  if (record.tags) record.tags = [...new Set(record.tags)].sort();
  if (record.acquisitions) {
    record.acquisitions = [...record.acquisitions].sort(byDate);
  }
  return record;
}

// Subtracting two undated lots gives NaN, and a sort is stable only where its
// comparison is an ordering.
function byDate(one: Acquisition, other: Acquisition): number {
  const first = when(one);
  const second = when(other);
  return first === second ? 0 : first < second ? -1 : 1;
}

// Undated lots sort first, and so does anything that won't parse.
function when(lot: Acquisition): number {
  const at = lot.at ? Date.parse(lot.at) : Number.NaN;
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

function reason(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
