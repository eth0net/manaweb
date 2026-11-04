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

`contents` is a union of seven arrays, and
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

The seventh is `variable_config`, which appears only inside a config and
carries its `weight`. Reading the configs without it makes a Welcome Deck
weighted 330 look as likely as the one weighted 4.

A product may carry several. `sealed` recurses — a booster box is 36 of a pack
— so it bottoms out in whichever kind the thing it names has. So does
`variable`: a config is a whole `contents`, nested configs and all.

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

**Join on the pair and leave `lang` out of it.** The index invites pinning it
to `en`, which silently drops a printing Default Cards holds in one other
language alone — Phyrexian `one` #283 and `pmei` #2023-1 are two of these 590.
Without it the pair is still unique, over all 119,509 in the cache.

**Decklists need the uuid map, and that is where the volume is.** Every board
keys by MTGJSON's own uuid and nothing else, so reaching them means
`cardIdentifiers`, which is 16.2MB of the 19.4MB this subject costs. It buys
**114,871 entries across 3,135 decklists**, against 590 from exact card
contents — so the map is not a saving to defer, it is 99.5% of the feature.

Seven boards, not one: `mainBoard` is 112,556 of those entries and the rest sit
in `sideBoard`, `commander`, `displayCommander`, `tokens`, `planes` and
`schemes`. Nor is a mainboard a given — five decklists are token sheets and
have none.

A uuid names a **part**, not a printing, so the map is many-to-one and wants
deduplicating on the Scryfall id rather than counted. Every printing on a
multi-part layout is affected and no printing of any other is: 2,440 of them,
over `transform`, `modal_dfc`, `adventure`, `split`, `prepare`,
`reversible_card` and `flip`, reaching five uuids for the five-part
`Who // What // When // Where // Why`.

**Tokens are keyed in a table of their own.** `cardIdentifiers` has no row for
one, so a `tokens` board resolves nowhere without `tokenIdentifiers` — and
neither do 17 `mainBoard` entries, which are the Theros challenge decks, whose
oversized cards MTGJSON files as tokens. 561 entries in all, closed by 924KB. A
further 24 close against nothing, carrying `not_in_mtgjson` where an id
belongs.

## What a pack can be shown as

The odds are not all the booster tables hold, and the rest of it is structure.
`setBoosterContents` gives the picks each layout variant takes from each sheet,
so the count printed on a wrapper falls out of the data instead of being
transcribed off one. Bloomburrow's play booster has four variants, differing in
two places:

| sheet                    | picks |
| ------------------------ | ----: |
| `common`                 |   6-7 |
| `uncommon`               |     3 |
| `rareMythicWithShowcase` |     1 |
| `wildcard`               |     1 |
| `foil`                   |     1 |
| `land` or `foilLand`     |     1 |
| `specialGuest`           |   0-1 |

A Special Guest takes a common's slot, which is why that row is a range, and
the land is foil or it is not. Neither statement needs a probability behind it.

**The pulls are `setBoosterSheetCards`** — 293,355 rows naming 78,994 distinct
cards over 4,465 sheets, for the 205 sets carrying booster data at all. Its
uuids resolve through the identifier table the boards already want. Held as
positions into the catalog it comes to a few MB before compression, so it is
not the part deciding how large any of this gets.

The weights exist and are exact, per variant and per card on a sheet. Leaving
them off a screen is a decision about what a reader can act on rather than a
gap in what we hold: every card a configuration draws from, listed under the
counts above, answers what a pack might hold without asserting what it will.

Sheet names belong to the set that defined them rather than to a fixed list.
Recent sets name a sheet for the slot it fills; a draft set from 2003 names
four of them after colors, so what reads as one line of commons elsewhere
arrives there as four.

## Where it shows

A product is not part of a set the way a card is: one published under a set
code can hold cards printed elsewhere, which is what `sourceSetCodes` records,
and a configuration can draw across several sets at once. So products browse
beside cards and sets rather than inside one, and what a product holds is a
list in its own right instead of a filter over the set it was published under.

## What this costs to run

Per-table CSV, not the whole dump: `AllPrintings.json.gz` is 183.9MB and
nothing here needs it.

| table                         | on the wire |
| ----------------------------- | ----------: |
| `cardIdentifiers`             |     16.2 MB |
| `setBoosterSheetCards`        |      4.3 MB |
| `setDecks`                    |      1.9 MB |
| `tokenIdentifiers`            |      924 KB |
| `sealedProducts`              |      417 KB |
| the other three `setBooster*` |       98 KB |

23.8MB a week in all. Builds land daily, there are no deltas, and every file
has a `.sha256` sidecar — so the check is a few hundred bytes and pulls only on
change, which for sealed data is far less often than daily. Against the 78MB of
Default Cards each week this does not compete.

Parquet sits at the same per-file addresses, serves byte ranges, and comes to
18.7MB for the same seven. Most of the gap is `setBoosterSheetCards`, 2.1
against 4.3, a column of uuids being what a column format is good at. The
saving worth having is narrower: reading `cardIdentifiers` as two columns
rather than every external id it carries. Both want a reader doing range
arithmetic, against a weekly figure nothing is straining at.

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
- **Where it lands in the artifact.** Measure before deciding anything: a
  client running to tens of MB is not worth an option, and only a measurement
  saying otherwise earns one.
- **The order a product's contents read in**, once one product recurses into
  another and a decklist runs to a hundred cards.
