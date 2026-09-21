// Name search over the whole catalog. A scan of 37,000 names costs a few
// milliseconds, so there is no index. Ranking is in `docs/search.md`.

export interface Index {
  names: string[];
  kinds: ArrayLike<number>;
  // Lower is better, from `scores`.
  scores: Float64Array;
  // How many kinds the file declares, buckets being one per tier per kind.
  kindCount: number;
}

// One popularity number per card, lower being better. An unranked card — every
// token, art series and basic land, negative in the column — is scored from
// its reprints instead.
export function scores(
  ranks: ArrayLike<number>,
  printings: ArrayLike<number>,
): Float64Array {
  let worst = 0;
  for (let card = 0; card < ranks.length; card++) {
    const rank = ranks[card] as number;
    if (rank > worst) worst = rank;
  }

  const scores = new Float64Array(ranks.length);
  for (let card = 0; card < ranks.length; card++) {
    const rank = ranks[card] as number;
    scores[card] = rank < 0 ? worst / (printings[card] as number) : rank;
  }
  return scores;
}

// So "jotun" finds "Jötun Grunt", "urzas" finds "Urza's Tower", and `//` on a
// split card is a word boundary.
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Exact, then starting a word, then anywhere.
const TIERS = 3;

// `keep` narrows what is searched, not what survives being searched.
export function search(
  index: Index,
  query: string,
  limit: number,
  keep?: (card: number) => boolean,
): number[] {
  const wanted = normalize(query);
  if (!wanted) return [];

  // Kinds come from the file: one added there would else change tier.
  const { names, kinds, scores, kindCount } = index;
  const buckets: number[][] = Array.from(
    { length: TIERS * kindCount },
    () => [],
  );

  for (let card = 0; card < names.length; card++) {
    const tier = rank(names[card] as string, wanted);
    if (tier !== null && (!keep || keep(card))) {
      const at = tier * kindCount + (kinds[card] as number);
      (buckets[at] as number[]).push(card);
    }
  }

  const found: number[] = [];
  for (const bucket of buckets) {
    if (found.length >= limit) break;
    // Rows arrive by name and the sort is stable, so equals stay alphabetical.
    bucket.sort((a, b) => (scores[a] as number) - (scores[b] as number));
    found.push(...bucket.slice(0, limit - found.length));
  }
  return found;
}

function rank(name: string, wanted: string): number | null {
  if (name === wanted) return 0;
  if (name.startsWith(wanted) || name.includes(` ${wanted}`)) return 1;
  if (name.includes(wanted)) return 2;
  return null;
}
