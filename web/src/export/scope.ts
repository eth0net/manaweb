import type { Stack } from "../collection/cards";
import { UNFILED } from "../collection/containers";

// Everything, rather than one container. Not a container's own key, which
// `UNFILED` already is.
export const ALL = "";

export function within(stacks: Stack[], scope: string): Stack[] {
  if (scope === ALL) return stacks;
  if (scope === UNFILED.key) {
    return stacks.filter((one) => one.value.container === undefined);
  }
  return stacks.filter((one) => one.value.container === scope);
}

// What the file is named after. Unfiled takes its route segment rather than
// its name, which is the same word the whole collection would go out under.
export function named(scope: string, places: Map<string, string>): string {
  if (scope === ALL) return "collection";
  if (scope === UNFILED.key) return UNFILED.key;
  return places.get(scope) ?? "cards";
}

// A name a file system takes, whatever a container was called.
export function plain(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "cards"
  );
}
