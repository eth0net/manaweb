// Narrowing and naming a list of sets. Pure, so the browser and the filter
// control share one answer and neither drags the other's view in.

import type { SetRow } from "./index";

export type Listed = { set: SetRow; printings: number };

// By name or by code, so "inv" finds Invasion and "lea" finds Alpha.
export function narrow(sets: Listed[], filter: string): Listed[] {
  const wanted = filter.trim().toLowerCase();
  if (!wanted) return sets;
  return sets.filter(
    ({ set }) =>
      set[1].toLowerCase().includes(wanted) || set[0].includes(wanted),
  );
}

// One set is worth naming; a handful is only worth counting.
export function label(sets: Listed[], chosen: string[]): string {
  if (chosen.length === 0) return "All sets";
  if (chosen.length > 1) return `${chosen.length} sets`;
  const only = chosen[0] as string;
  return sets.find(({ set }) => set[0] === only)?.set[1] ?? only.toUpperCase();
}
