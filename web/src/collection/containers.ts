import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Main } from "../lexicons/app/manaweb/container";
import {
  create,
  type Fields,
  type Held,
  list,
  remove,
  rkey,
} from "../oauth/repo";

export const CONTAINER = "app.manaweb.container";

export type Container = Fields<Main>;

// The lexicon's `knownValues`, which it calls cosmetic, so the order is ours.
export const KINDS = ["binder", "box", "deckBox", "shelf", "other"];

// Nothing picked leaves `container` off the record, which the lexicon reads as
// unfiled, so this is a name and a route segment but never a record.
export const UNFILED = { name: "Collection", key: "unfiled" };

export type Containers = {
  held: Held<Container>[];
  error?: string;
  add: (name: string, kind: string) => Promise<void>;
  drop: (uri: string) => Promise<void>;
};

export function useContainers(session: OAuthSession | null): Containers {
  const [held, setHeld] = useState<Held<Container>[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!session) {
      setHeld([]);
      return;
    }
    let live = true;
    list<Container>(session, CONTAINER).then(
      (found) => live && setHeld(found),
      (failure: unknown) => live && setError(reason(failure)),
    );
    return () => {
      live = false;
    };
  }, [session]);

  const add = useCallback(
    async (name: string, kind: string) => {
      if (!session) return;
      const record: Container = {
        name: name.trim(),
        createdAt: new Date().toISOString(),
        ...(kind ? { kind } : {}),
      };
      try {
        const written = await create(session, CONTAINER, record);
        setHeld((was) => [...was, { ...written, value: record }]);
      } catch (failure) {
        setError(reason(failure));
      }
    },
    [session],
  );

  const drop = useCallback(
    async (uri: string) => {
      if (!session) return;
      try {
        await remove(session, CONTAINER, rkey(uri));
        setHeld((was) => was.filter((one) => one.uri !== uri));
      } catch (failure) {
        setError(reason(failure));
      }
    },
    [session],
  );

  // Stable while nothing moves, so a list rendering thousands of rows can
  // skip the ones this did not change.
  return useMemo(() => ({ held, error, add, drop }), [held, error, add, drop]);
}

function reason(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
