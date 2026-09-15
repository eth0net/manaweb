import { type ReactNode, useEffect, useSyncExternalStore } from "react";

export const TABS = [
  { path: "/cards", label: "Cards" },
  { path: "/collection", label: "Collection" },
  { path: "/decks", label: "Decks" },
  { path: "/lists", label: "Lists" },
];

export const HOME = "/cards";

// A tab and everything it drills down into.
function within(path: string, at: string): boolean {
  return path === at || path.startsWith(`${at}/`);
}

// Whether the bar can mark this path. An OAuth callback and a bare `/` can't,
// and are the only paths anything rewrites.
export function known(path: string): boolean {
  return TABS.some(({ path: at }) => within(path, at));
}

export function tab(path: string): string {
  const found = TABS.find(({ path: at }) => within(path, at));
  return found ? found.path : HOME;
}

// Where each tab was last left, for as long as the page lives. Toggling between
// a set and what you own is then one move each way.
const seen = new Map<string, string>();

export function remember(to: string): void {
  const path = to.split("?")[0] ?? to;
  if (known(path)) seen.set(tab(path), to);
}

// Where a tab's own button goes: back where you left it, except from inside
// that tab, where the same press is how you get out of a drill-down.
export function entry(to: string, here: string): string {
  return here === to ? to : (seen.get(to) ?? to);
}

// What a search was narrowed to is part of where you are, so the address is
// the path and its query together and every comparison here is against both.
function address(): string {
  return location.pathname + location.search;
}

// Corrects the address bar without adding a step to go back through.
export function replace(to: string): void {
  if (to === address()) return;
  history.replaceState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function navigate(to: string): void {
  if (to === address()) return;
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

// One setting changed and the rest kept. `step` is for the ones worth pressing
// back out of, which typing is not.
export function amend(changes: Record<string, string>, step = false): void {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }

  const query = params.toString();
  const to = location.pathname + (query ? `?${query}` : "");
  if (step) navigate(to);
  else replace(to);
}

function subscribe(listen: () => void): () => void {
  addEventListener("popstate", listen);
  return () => removeEventListener("popstate", listen);
}

const pathname = () => location.pathname;
const query = () => location.search;

export function usePath(): string {
  const path = useSyncExternalStore(subscribe, pathname);
  const search = useSyncExternalStore(subscribe, query);

  useEffect(() => remember(path + search), [path, search]);

  return path;
}

export function useSettings(): URLSearchParams {
  return new URLSearchParams(useSyncExternalStore(subscribe, query));
}

export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        // A modified click is the browser's to answer, not ours.
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
