import { useCallback, useEffect, useRef, useState } from "react";
import type { Manifest } from "./catalog";
import { type Loaded, latest, load, same } from "./catalog/load";
import { clear } from "./catalog/store";

// A page load reads the manifest anyway, so this is for a tab left open across
// a publish.
const EVERY = 6 * 60 * 60 * 1000;

// A sleeping machine fires no timers, so a returning tab checks for itself.
const STALE = 60 * 60 * 1000;

export type Load =
  | { status: "loading"; step: string }
  | ({ status: "ready" } & Loaded)
  | { status: "failed"; error: string };

export interface Status {
  load: Load;
  // A newer catalog than the one loaded, if the last check found one.
  available: Manifest | null;
  checkedAt: Date | null;
  checking: boolean;
  // A failed check, which leaves the loaded catalog alone.
  error: string | null;
  check: () => void;
  // Loads the catalog the last check found.
  apply: () => void;
  // Throws the cache away and loads again from the network.
  reset: () => void;
}

// Once per page however many components ask, including twice under StrictMode.
let pending: Promise<Loaded> | null = null;
let step = "Starting";

export function useCatalog(): Status {
  const [state, setState] = useState<Load>({ status: "loading", step });
  const [available, setAvailable] = useState<Manifest | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // What a check compares against.
  const loaded = useRef<Manifest | null>(null);

  const start = useCallback(() => {
    if (pending === null) {
      pending = load((of) => {
        step = of;
        if (alive.current) setState({ status: "loading", step: of });
      });
    }

    const mine = pending;
    mine
      .then((done) => {
        // A load `apply` orphaned must not land on the one replacing it.
        if (pending !== mine || !alive.current) return;
        loaded.current = done.manifest;
        setState({ status: "ready", ...done });
        setAvailable(null);
        setError(null);
        setCheckedAt(new Date());
      })
      .catch((raised: unknown) => {
        // A failed load is not kept: the next attempt starts over.
        if (pending === mine) pending = null;
        if (alive.current) setState({ status: "failed", error: said(raised) });
      });
  }, []);

  useEffect(start, [start]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const found = await latest();
      const current = loaded.current;
      if (!alive.current) return;
      setAvailable(current && !same(current, found) ? found : null);
      setError(null);
    } catch (raised: unknown) {
      if (alive.current) setError(said(raised));
    } finally {
      if (alive.current) {
        // A failed check is still a check, or the timer below retries at once.
        setCheckedAt(new Date());
        setChecking(false);
      }
    }
  }, []);

  const apply = useCallback(() => {
    pending = null;
    setAvailable(null);
    setState({ status: "loading", step: "Loading the new catalog" });
    start();
  }, [start]);

  const reset = useCallback(async () => {
    await clear();
    apply();
  }, [apply]);

  // Rescheduled by `checkedAt`, so the wait runs from the last check.
  useEffect(() => {
    if (state.status !== "ready") return;

    const since = checkedAt ? Date.now() - checkedAt.getTime() : EVERY;
    const timer = setTimeout(() => void check(), Math.max(0, EVERY - since));

    const woken = () => {
      if (document.visibilityState !== "visible") return;
      if (!checkedAt || Date.now() - checkedAt.getTime() > STALE) void check();
    };
    document.addEventListener("visibilitychange", woken);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", woken);
    };
  }, [state.status, checkedAt, check]);

  return {
    load: state,
    available,
    checkedAt,
    checking,
    error,
    check: () => void check(),
    apply,
    reset: () => void reset(),
  };
}

function said(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
