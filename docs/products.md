# Sealed products

What a pack, box or precon holds, and which of them a card can be found in.
Scryfall answers neither: a card object carries `booster: bool` and stops, and
there is no product object at all.

MTGJSON does, and it is the only feed that does. Figures below are measured
against build `5.3.0+20261103` and the catalog of 2026-10-28.

## What it carries

`SealedProduct` hangs off every set, and off every entry of `SetList` — so the
whole catalog is one small file rather than a slice of a large one. 4,315
products across 351 set codes, reaching back to the 1990s.

`contents` is a union of six arrays, and
**which one a product has decides
whether the answer is a fact or a probability**:

| kind       | products | holds                               | answer |
| ---------- | -------: | ----------------------------------- | ------ |
| `deck`     |    2,183 | a named decklist in `setDecks`      | exact  |
| `sealed`   |    2,004 | `count` of another product          | exact  |
| `pack`     |    1,187 | a booster config name               | chance |
| `other`    |      859 | a name only — spindowns, storage    | none   |
| `card`     |      481 | a named printing, by set and number | exact  |
| `variable` |       74 | configs that differ between copies  | chance |

A product may carry several. `sealed` recurses — a booster box is 36 of a pack
— so it bottoms out in whichever kind the thing it names has.

**A booster is a weighted model, not a list.** A set's `booster` object is
keyed by config name, each config a weighted choice of layout over weighted
sheets. Bloomburrow's collector config draws from three sets across eight
sheets. Nothing about it says a pack _contains_ a card, only that it can.

`Card.sourceProducts` looks like the index this subject wants and is not: it is
every product whose sheets a card sits on, so a common's foil list runs to
twenty products it will almost never be in. Exact for `card` and `deck`
contents, a could-contain elsewhere. **Shown as a fact it is a lie**, which is
the one thing to get right before any of this reaches a screen.

## The join

**Exact card contents need nothing new.** `SealedProductCard` carries `set` and
`number`, and the cache already has `cards_printing` unique over
`(set_code, collector_number, lang)`. Measured: **590 of 590 entries resolve**,
and 4,268 of the 4,315 products sit in sets the cache holds. The 47 that do not
are Mystery Booster and a handful of older promo sets.

**Decklists need the uuid map, and that is where the volume is.** Every board
keys by MTGJSON's own uuid and nothing else, so reaching them means
`cardIdentifiers`, which is 16.2MB of the 18.5MB this subject costs. It buys
**114,426 card entries across 3,135 decklists**, against 590 from exact card
contents — so the map is not a saving to defer, it is 99.5% of the feature.

The uuid side is one row per face for `transform` and `modal_dfc`, each
repeating the printing's single Scryfall id, so the map is many-to-one and
wants deduplicating on the id rather than counted.

## What this costs to run

Per-table CSV, not the whole dump: `AllPrintings.json.gz` is 183.9MB and
nothing here needs it.

| table                  | on the wire |
| ---------------------- | ----------: |
| `cardIdentifiers`      |     16.2 MB |
| `setDecks`             |      1.9 MB |
| `sealedProducts`       |      417 KB |
| the four `setBooster*` |      4.4 MB |

Builds land daily, there are no deltas, and every file has a `.sha256` sidecar
— so the check is a few hundred bytes and pulls only on change, which for
sealed data is far less often than daily. Against the 78MB of Default Cards
each week this does not compete.

**Refresh after the Scryfall sync, never before.** The join resolves against
the cache, so a product for a set the cache has not taken yet drops its rows
without saying so. An export that loses more than a trivial share should refuse
rather than publish a product holding half its contents.

## Licensing

MTGJSON is MIT, holding only that the copyright and permission notice travel
with substantial portions — which puts it beside the existing attributions
rather than anywhere new. Read <https://mtgjson.com/license/>; note the text
grants rights over "this software" and the site applies it to the data, a
looseness worth knowing about rather than relying on.

Two things it cannot convey, both in [`ip.md`](ip.md):

- **Wizards' rights flow through unchanged.** Product names are theirs on the
  same footing as card names, whoever hands them to us.
- **Prices are somebody else's commercial feed.** MTGJSON republishes
  Cardmarket and TCGplayer figures under terms it does not hold, so the price
  files are a separate decision from this one and are not taken here. Sealed
  and booster data is MTGJSON's own curation and carries none of that.

Reaching MTGJSON's card columns is reaching Scryfall's data by another route,
so it is no laundering step for anything Scryfall's terms already govern.

## Open

- **Totality.** Three sets were checked card-for-card, not the whole corpus.
  Count before anything depends on every printing being present.
- **Where it lands in the artifact.** The base pair is already 4.21MB against a
  4–5MB target, so products are almost certainly an opt-in part — but the size
  wants measuring rather than assuming.
- **The order a product's contents read in**, once one product recurses into
  another and a decklist runs to a hundred cards.
