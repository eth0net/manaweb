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

export const CARD = "app.manaweb.card";

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

// One record, and where the repo holds it.
export type Stack = Held<Owned>;

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
): Holdings {
  const [held, setHeld] = useState<Stack[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  // Which read is the current one, so a slow answer to a stale session or an
  // unmounted view lands nowhere.
  const read = useRef(0);

  const reload = useCallback(() => {
    if (!session) {
      setHeld([]);
      setReady(false);
      return;
    }
    const mine = ++read.current;
    list<Owned>(session, CARD).then(
      (found) => {
        if (mine !== read.current) return;
        setHeld(found);
        setReady(true);
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

  const totals = useMemo(() => {
    const prints = new Map<string, number>();
    const finishes = new Map<string, number>();
    const places = new Map<string | null, number>();
    let total = 0;
    for (const { value } of held) {
      const print = value.scryfallId;
      const finish = JSON.stringify([print, value.finish]);
      const place = value.container ?? null;
      prints.set(print, (prints.get(print) ?? 0) + value.quantity);
      finishes.set(finish, (finishes.get(finish) ?? 0) + value.quantity);
      places.set(place, (places.get(place) ?? 0) + value.quantity);
      total += value.quantity;
    }
    return { prints, finishes, places, total };
  }, [held]);

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
    stacks: held,
    printings,
    total: totals.total,
    add,
    take,
    amend,
    unfile,
    reload,
  };
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
