import {
  appLanguage,
  type Card,
  cardName,
  language,
  type Print,
  words,
} from "./catalog";

// Card names are read in the app's language, not the printing's. A setting of
// its own once there is somewhere to put it — see `docs/search.md`.
const APP = appLanguage();

// One owner for which of a card's names is shown, the modal's title having to
// agree with the row that opened it.
export function titled(card: Card, print: Print | undefined) {
  return cardName(card.name, print, APP);
}

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
