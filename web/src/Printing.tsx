import { language, type Print, words } from "./catalog";

export function Language({ code }: { code: string }) {
  return (
    <span className="tag" title={language(code)}>
      {code}
    </span>
  );
}

// Nothing renders behind these, so a thumbnail would be a broken image.
const NO_IMAGE = new Set(["missing", "placeholder"]);

export function hasArt(print: Print): boolean {
  return !NO_IMAGE.has(print.imageStatus);
}

// Counted over the cache rather than taken from Scryfall's layout list, and
// `art_series` is in it on a majority — see `docs/scryfall.md`.
const TURNS = new Set([
  "transform",
  "modal_dfc",
  "double_faced_token",
  "reversible_card",
  "art_series",
]);

export function twoSided(print: Print): boolean {
  return TURNS.has(print.layout);
}

// One printing, as much of it as it has. Language is a tag of its own.
export function describe(print: Print) {
  return [
    `${print.setName} · ${print.set.toUpperCase()} #${print.collectorNumber}`,
    print.rarity,
    print.artist,
    ...print.flags.map(words),
  ]
    .filter(Boolean)
    .join(" · ");
}
